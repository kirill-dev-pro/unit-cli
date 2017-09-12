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
const log = require('loglevel')
const ProgressBar = require('progress')

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
  .option('-o, --loglevel [level]', 'Set level of logs to print', 'info')
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
    log.debug(colors.red(options.method), options.url)
    let htmlString = await request(options)
    return JSON.parse(htmlString)
  } catch (err) {
    log.error(err, err.stack)
  }
}

async function getUnits (user) {
  let units = []
  let list = await getApi(user, 'users', user.login, 'units')
  for (let item of list.items) {
    // @TODO: make here some progress bar or something
    let unit
    let deploy = await getDeploy(item.name, user)
    if (deploy) {
      unit = deploy.unit
      unit.parameters = deploy.parameters
    } else {
      unit = await getUnit(user, item.name)
    }
    units.push(unit)
  }
  return units
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
    log.error(err, err.stack)
  }
}

function saveParameters (path, parameters) {
  let config = {
    secret: {},
    public: {}
  }
  for (let param of parameters) {
    if (param && param.name) {
      config[param.type][param.name] = param.value
    }
  }
  fs.writeFileSync(path, beautify(config, null, 2, 10))
}

function parseParameters (config) {
  let parameters = []
  Object.keys(config.public).forEach((key) => {
    parameters.push({
      name: key,
      type: 'public',
      value: config.public[key]
    })
  })
  Object.keys(config.secret).forEach((key) => {
    parameters.push({
      name: key,
      type: 'secret',
      value: config.secret[key]
    })
  })
  return parameters
}

async function updateUnit (unitName, user, newContent) {
  try {
    let deploy = await getDeploy(unitName, user)
    if (!deploy) return null // @TODO: create deploy here
    log.trace('[CONTENT]'.debug, newContent)
    log.trace('[DEPLOY]'.debug, JSON.stringify(deploy))
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
    log.trace('[OPTIONS]'.debug, options)
    return await request(options)
  } catch (err) {
    log.error(err, err.stack)
  }
}

function getContent (file) {
  try {
    let name = path.parse(file).name
    let content = fs.readFileSync(file, 'utf-8')
    switch (name) {
      case 'index': return {code: content}
      case 'readme': return {readme: content}
      case 'config': return {parameters: parseParameters(JSON.parse(content))}
      default: return null
    }
  } catch (error) {
    log.error(error)
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
  log.info('Hi! It seems you try to start Unit-cli first time')
  log.info('Enter your UnitCluster login and API key ')
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
  log.debug('[RUN UNIT]'.debug, name)
  let result
  try {
    let options = {
      url: urlConstructor('run', user, name),
      method: 'GET',
      headers: {
        Authorization: 'UCKEY ' + user.key
      }
    }
    log.debug('GET'.red, options.url)
    try {
      result = await request(options)
    } catch (requestError) {
      let error = JSON.parse(requestError.error)
      log.error('[Module %s error] '.error + error.error, name)
      if (error.position.line) { log.error('at line', error.position.line) } else { log.error('%s'.error, error.position) }
    }
  } catch (error) {
    log.error(error)
  }
  if (!result) return
  log.info('[ %s ]'.info, name, result)
  return result
}

async function printUnitLogs (unitName, user) {
  let url = urlConstructor('logs', user, unitName)
  log.debug('[LOG]'.red, url)
  let logStream = request(url)
  logStream.on('data', (chunk) => {
    // Parse logs
    if (chunk.toString().substring(0, 5) === 'data:') {
      let message = JSON.parse(chunk.toString().substring(5))
      if (message.log) {
        log.info('[ %s ]'.info, message.ts)
        log.info('[ %s ] :'.info, message.slot, message.log)
      }
      if (message.memory || message.cpu) {
        // do something with stats
      }
    }
  })
  logStream.on('end', () => {
    log.debug('[ %s-%s ]'.info, unitName, moment().format())
    log.debug('End of logs')
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
  log.debug('GET'.red, options)
  let result
  try {
    result = await request(options)
  } catch (error) {
    log.error(error)
  }
  log.trace(result)
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
    log.error(err, err.stack)
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

function compareParameters (params1, params2) {
  try {
    if (params1.length !== params2.length) return false
    for (let i in params1) {
      if (params1[i].name === params2[i].name &&
        params1[i].value === params2[i].value &&
        params1[i].type === params2[i].type) {
        return false
      }
    }
    return true
  } catch (error) {
    return false
  }
}

function watchUnits (user, unitUpdated) {
  watch(user.path, { recursive: true }, async (evt, filePath) => {
    if (notDuplicateEvent(filePath)) {
      let file = path.parse(filePath)
      log.debug('%s changed'.debug, file.base)
      log.debug('in %s'.debug, file.dir)
      let unitName = file.dir.replace(user.path + '/', '')
      let content = getContent(filePath)
      if (content) {
        log.trace(content)
        log.info('Changes in "'.debug + unitName + '", updating...'.debug)
        let result = await updateUnit(unitName, user, content) // here should be object like {code: "let a..."} or {readme:}
        let key = _.keys(content)[0]
        log.trace('[RESULT]'.debug, result)
        let resultState
        if (key === 'parameters') {
          resultState = compareParameters(content.parameters, JSON.parse(result).deployment.parameters)
        } else {
          resultState = JSON.parse(result)[key] !== content[key]
        }
        if (resultState) { // Sceret params are not belongs to unit but to the deployment
          log.warn('Unit not saved'.error)
        } else {
          log.info('Press', '[Enter]'.cyan, 'to run', colors.info(unitName))
          unitUpdated.name = unitName
        }
      }
    }
  })
  log.info('Watching units in %s for changes...'.debug, user.path)
}

function checkRunUnit (unitUpdated, user) {
  if (unitUpdated.name) {
    // run unit
    runUnit(unitUpdated.name, user)
    log.debug('[Enter]'.info, unitUpdated.name)
  }
}

async function main () {
  let unitUpdated = { name: null }
  let user
  log.setDefaultLevel('info')
  log.setLevel(program.loglevel)
  try {
    user = await init()
  } catch (err) {
    log.debug('Exiting..'.error)
    return
  }

  log.trace(colors.debug(JSON.stringify(user)))

  updateUserParameters(program, user)

  try {
    createUnitsPath(user.path)
  } catch (e) {
    log.error(e)
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
      fn: log.debug,
      args: ['Backspace'.info]
    },
    {
      button: 'escape',
      fn: (a) => { log.debug(JSON.stringify(a)) },
      args: [unitUpdated]
    }
  ])

  watchUnits(user, unitUpdated)
}

main()
