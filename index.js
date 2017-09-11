#!/usr/bin/env node

// So this is a comand line tool, it should watch dir and update your unitcluster unit on change of this unit localy

/**
 * how should it work
 * 1. get / delete units
 * 2. watch and produce events
 * 3. update, upload local units to cloud
 */

const program = require('commander')
const fs = require('fs')
const path = require('path')
const request = require('request-promise-native')
const Readline = require('readline')
const keypress = require('keypress')
const colors = require('colors')
const _ = require('underscore')
const moment = require('moment')
const beautify = require('json-beautify')
const watch = require('node-watch')

colors.setTheme({
  silly: 'rainbow',
  input: 'grey',
  verbose: 'cyan',
  prompt: 'grey',
  info: 'green',
  data: 'grey',
  help: 'cyan',
  warn: 'yellow',
  debug: 'blue',
  error: 'red'
})

const readline = Readline.createInterface({
  input: process.stdin,
  output: process.stdout
})
let watched = []
let lastEvent = 0

program
  .version('0.1.0')
  .option('-d, --dir [dir]', 'Define path to save units')
  .option('-l, --login [login]', 'Set login to sync units from unitcluster')
  .option('-k, --key [key]', 'Set API key from your Unitcluster account')
  .option('-n, --new [unit]', 'Create new unit')
  .option('-s, --server [server]', 'Set server to work with')
  .parse(process.argv)

function urlConstructor (type, user, name) {
  let url
  if (type === 'logs' || type === 'run') {
    if (/unitcluster\.com/.test(user.server)) {
      url = 'https://' + user.login + '.unit.run/' + name
    } else {
      url = user.server.replace('//', '//' + user.login + '.').replace('https', 'http') + '/' + name
    }
    if (type === 'logs') {
      url += '/logs'
    }
    if (user.key) {
      url += '?key=' + user.key
    }
    return url
  }
}

async function getApi (user) {
  try {
    let apiString = 'api/'
    let params = _.omit(arguments, '0')
    apiString += path.join(_.values(params).join('/'))
    // for (let arg of params) {
    //   if (typeof arg === 'string') { apiString = path.join(apiString, arg) }
    // }
    let options = {
      url: user.server + '/' + apiString,
      method: 'GET',
      headers: {
        Authorization: 'UCKEY ' + user.key
      }
      // followRedirect: false
    }
    console.log(colors.red(options.method), options.url)
    let htmlString = await request(options)
    return JSON.parse(htmlString)
  } catch (err) {
    console.error(err, err.stack)
  }
}

async function getUnits (user) {
  let units = await getApi(user, 'users', user.login, 'units')
  return units.items
}

async function getUnit (user, name) {
  let unit = getApi(user, 'units', user.login, name)
  return unit
}

function saveUnits (units, dir) {
  for (let unit of units) {
    saveUnit(unit, dir)
  }
}

function saveUnit (unit, dir) {
  try {
    let unitPath = path.join(dir, unit.name)
    let codeFile
    let readmeFile
    let configFile
    if (unit.language === 'javascript') {
      codeFile = unitPath + '/index.js'
      readmeFile = unitPath + '/readme.md'
      configFile = unitPath + '/config.json'
      if (watched.indexOf(codeFile) === -1) {
        watched.push(codeFile, readmeFile, configFile)
      }
    }
    createUnitsPath(unitPath)
    fs.writeFileSync(codeFile, unit.code)
    fs.writeFileSync(readmeFile, unit.readme)
    saveParameters(configFile, unit.parameters ? unit.parameters : [])
  } catch (err) {
    console.error(err, err.stack)
  }
}

function saveParameters (path, parameters) {
  let config = {
    secret: {},
    public: {}
  }
  for (let param of parameters) {
    config[param.type][param.name] = param.value
  }
  fs.writeFileSync(path, beautify(config, null, 2, 10))
}

async function updateUnit (unitName, user, newContent) {
  try {
    let deploy = await getDeploy(unitName, user)
    if (!deploy) return null // @TODO: create deploy here
    console.log('[CONTENT]'.debug, newContent)
    console.log('[DEPLOY]'.debug, JSON.stringify(deploy))
    let options = {
      method: 'PATCH',
      url: user.server + '/' + path.join('api', 'units', user.login, unitName),
      headers: {
        Authorization: 'UCKEY ' + user.key
      },
      form: {
        code: newContent.code ? newContent.code : deploy.unit.code,
        readme: newContent.readme ? newContent.readme : deploy.unit.readme,
        parameters: newContent.parameters ? newContent.parameters : deploy.parameters,
        deployment_id: deploy.id,
        full_name: user.login + '/' + unitName
      }
    }
    console.log('[OPTIONS]'.debug, options)
    return await request(options)
  } catch (err) {
    console.error(err, err.stack)
  }
}

function getContent (file) {
  let name = path.parse(file).name
  let content = fs.readFileSync(file, 'utf-8')
  switch (name) {
    case 'index': return {'code': content}
    case 'readme': return {'readme': content}
    case 'config': return {'parameters': content}
    default: return null
  }
}

// If not duplicate and unit file
function notDuplicateEvent (filePath) {
  let currentTime = Math.floor(new Date() / 1000)
  if (watched.indexOf(filePath) > -1 && lastEvent + 3 < currentTime) {
    lastEvent = currentTime
    return true
  } else {
    return false
  }
}

// Initial

function getUserHome () {
  return process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'] + '/'
}

function saveUser (user) {
  fs.writeFileSync(getUserHome() + '.unit-cli.json', JSON.stringify(user), 'utf-8')
}

function question (question) {
  return new Promise((resolve) => {
    readline.question(question, (answer) => {
      resolve(answer)
    })
  })
}

async function askUserToLogin () {
  let user = {}
  let defaultPath = path.join(process.cwd(), 'units')
  console.log('Hi! It seems you try to start Unit-cli first time')
  console.log('Enter your UnitCluster login and API key ')
  user.login = await question('Login: ')
  user.key = await question('API key: ')
  user.path = await question('Folder to sync your units to [' + defaultPath + ']: ')
  if (!user.path) {
    user.path = defaultPath
  }
  // we dont need another server, anyway it could be changed by -s parameter
  // user.server = await question('Enter your server [ https://unitcluster.com ]: ')
  if (!user.server) {
    user.server = 'https://unitcluster.com'
  }
  saveUser(user)
  return user
}

function getUser () {
  let data = fs.readFileSync(getUserHome() + '.unit-cli.json', 'utf-8')
  return JSON.parse(data)
}

async function init () {
  let user
  if (!fs.existsSync(getUserHome() + '.unit-cli.json')) {
    user = await askUserToLogin()
  } else {
    user = getUser()
  }
  if (user.login && user.key) {
    return user
  } else {
    throw new Error('User import error')
  }
}

// Run Unit on update

async function runUnit (unitName, user) {
  // get deploy name
  // run deploy
  // get logs from deploy

  let deploy = await getDeploy(unitName, user)
  if (!deploy) {
    // create new deploy
    deploy = await createNewDeploy(unitName, user, false) // public: false
  }
  printUnitLogs(deploy.name, user)
  runDeploy(deploy.name, user)
}

async function runDeploy (name, user) {
  if (!name) return
  console.log('[RUN UNIT]', name)
  let result
  try {
    let options = {
      url: urlConstructor('run', user, name),
      method: 'GET',
      headers: {
        Authorization: 'UCKEY ' + user.key
      }
    }
    console.log('GET'.red, options.url)
    try {
      result = await request(options)
    } catch (requestError) {
      let error = JSON.parse(requestError.error)
      console.error('[Module %s error] '.error + error.error, name)
      if (error.position.line) { console.error('at line', error.position.line) } else { console.error('%s'.error, error.position) }
    }
  } catch (error) {
    console.error(error)
  }
  if (!result) return
  console.log('[ %s ]'.info, name, result)
  return result
}

async function printUnitLogs (unitName, user) {
  let url = urlConstructor('logs', user, unitName)
  console.log('[LOG]'.red, url)
  let logStream = request(url)
  logStream.on('data', (chunk) => {
    // Parse logs
    if (chunk.toString().substring(0, 5) === 'data:') {
      let message = JSON.parse(chunk.toString().substring(5))
      if (message.log) {
        console.log('[ %s ]'.info, message.ts)
        console.log('[ %s ] :'.info, message.slot, message.log)
      }
      if (message.memory || message.cpu) {
        // do something with stats
      }
    }
  })
  logStream.on('end', () => {
    console.log('[ %s-%s ]'.info, unitName, moment().format())
    console.log('End of logs')
  })
}

async function getDeploy (unitName, user) {
  let deploys = await getApi(user, 'units', user.login, unitName, 'deployed')
  if (deploys.stats > 0) {
    return deploys.units[0]
  } else {
    return null
  }
}

async function createNewDeploy (unitName, user, isPublic) {
  let options = {
    url: `${user.server}/api/units/${user.login}/${unitName}/deploy`,
    headers: {
      Authorization: 'UCKEY ' + user.key
    },
    method: 'POST',
    form: {
      name: unitName,
      public: isPublic,
      full_name: user.login + '/' + unitName
    }
  }
  console.log('GET'.red, options)
  let result
  try {
    result = await request(options)
  } catch (error) {
    console.error(error)
  }
  console.log(result)
  return JSON.parse(result)
}

function updateDeploy (deploy, user, newCode) {
  request.patch(user.server + '/api/deployed/' + deploy.id)
    .headers({
      Authorization: 'UCKEY ' + user.key
    })
    .form({
      code: newCode
    })
}

function deleteDeploy (deploy, user) {
  request.delete(user.server + '/api/deployed/' + deploy.id)
    .headers({
      Authorization: 'UCKEY ' + user.key
    })
}

// Check for parameters to be changed
function updateUserParameters (program, user) {
  if (program.dir || program.key || program.login) {
    if (program.dir) {
      user.path = program.dir
    }
    if (program.key) {
      user.key = program.key
    }
    if (program.login) {
      user.login = program.login
    }
    if (program.server) {
      user.server = program.server
    }
    saveUser(user)
  }
}

function createUnitsPath (path) {
  try {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path)
    }
  } catch (err) {
    console.error(err, err.stack)
    throw new Error('Cannot create directory, check permisions')
  }
}

function watchKeypressed (input, events) {
  keypress(input)
  for (let event of events) {
    input.on('keypress', (ch, key) => {
      if (key && key.name === event.button) {
        // do some stuff
        event.fn.apply({}, event.args)
      }
    })
  }
  input.setRawMode(true)
  input.resume()
}

function watchUnits (user, unitUpdated) {
  watch(user.path, { recursive: true }, async (evt, filePath) => {
    if (notDuplicateEvent(filePath)) {
      let file = path.parse(filePath)
      console.log('%s changed'.debug, file.base)
      console.log('in %s'.debug, file.dir)
      let unitName = file.dir.replace(user.path + '/', '')
      let content = getContent(filePath)
      if (content) {
        console.log(content)
        console.log('Changes in "'.debug + unitName + '", updating...'.debug)
        let result = await updateUnit(unitName, user, content) // here should be object like {code: "let a..."} or {readme:}
        let key = _.keys(content)[0]
        if (JSON.parse(result)[key] !== content[key]) {
          // console.log(key, JSON.parse(result), content)
          console.error('Unit not saved'.error)
        } else {
          console.log('Press', '[Enter]'.cyan, 'to run', colors.info(unitName))
          unitUpdated.name = unitName
        }
      }
    }
  })
  console.log('Watching units in %s for changes...'.debug, user.path)
}

function checkRunUnit (unitUpdated, user) {
  if (unitUpdated.name) {
    // run unit
    runUnit(unitUpdated.name, user)
    console.log('[Enter]'.info, unitUpdated.name)
  }
}

async function main () {
  let unitUpdated = { name: null }
  let user
  try {
    user = await init()
  } catch (err) {
    console.log('Exiting..'.error)
    return
  }

  console.log(colors.debug(JSON.stringify(user)))

  updateUserParameters(program, user)

  try {
    createUnitsPath(user.path)
  } catch (e) {
    console.error(e)
    return
  }

  let units = await getUnits(user)
  saveUnits(units, user.path)

  watchKeypressed(process.stdin, [
    {
      button: 'return',
      fn: checkRunUnit,
      args: [unitUpdated, user]
    },
    {
      button: 'backspace',
      fn: console.log,
      args: ['Backspace'.info]
    },
    {
      button: 'escape',
      fn: (a) => { console.log(JSON.stringify(a)) },
      args: [unitUpdated]
    }
  ])

  watchUnits(user, unitUpdated)
}

main()
