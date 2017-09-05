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

const runUrl = (name, user) => {
  if (/unitcluster\.com/.test(user.server)) {
    return `https://${user.login}.unit.run/${name}` + (user.key ? '?key=' + user.key : '')
  } else {
    return user.server.replace('//', '//' + user.login + '.').replace('https', 'http') + '/' + name
  }
}
let watched = []
let lastEvent = 0

program
  .version('0.1.0')
  .option('-d, --dir [dir]', 'Name a dir [current]', './units')
  .option('-l, --login [login]', 'Set login to sync units from unitcluster')
  .option('-k, --key [key]', 'Set API key from your Unitcluster account')
  .option('-n, --new [unit]', 'Create new unit')
  .option('-b, --daemon [true]', 'Run as a daemon', (val) => { return !val }, true)
  .parse(process.argv)

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
        'Authorization': 'UCKEY ' + user.key
      }
      // followRedirect: false
    }
    console.log(options.method, options.url)
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
    let filePath = path.join(dir, unit.name)
    if (unit.language === 'javascript') {
      filePath += '.js'
      if (watched.indexOf(unit.name) === -1) {
        watched.push(unit.name + '.js')
      }
    }
    // let file = fs.open(filePath)
    fs.writeFileSync(filePath, unit.code)
  } catch (err) {
    console.error(err, err.stack)
  }
}

async function updateUnit (unitName, user, newCode) {
  try {
    let unit = await getUnit(user, unitName)
    unit.code = newCode
    let options = {
      method: 'PATCH',
      url: user.server + '/' + path.join('api', 'units', user.login, unitName),
      headers: {
        'Authorization': 'UCKEY ' + user.key
      },
      form: {code: newCode}
    }
    return await request(options)
  } catch (err) {
    console.error(err, err.stack)
  }
}

function getCode (file) {
  let code = fs.readFileSync(file, 'utf-8')
  return code
}

// If not duplicate and unit file
function notDuplicateEvent (filename) {
  let current = Math.floor(new Date() / 1000)
  if (watched.indexOf(filename) > -1 && lastEvent + 3 < current) {
    lastEvent = current
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
  let defaultPath = path.join(__dirname, 'units')
  console.log('Hi! It seems you try to start Unit-cli first time')
  console.log('Tell me your login and API key from your user account')
  user.login = await question('Login: ')
  user.key = await question('API key: ')
  user.path = await question('Enter path to save your unitst [' + defaultPath + ']: ')
  if (!user.path) {
    user.path = defaultPath
  }
  user.server = await question('Enter your server [ https://unitcluster.com ]: ')
  if (!user.server) {
    user.server = 'https://unitcluster.com'
  }
  // if (user.path !== path.basename(user.path)) { // ask again
  //  do {
  //    user.path = await question('You enter invalid path. Try again. Or leave it blank for default: ')
  //    if (!user.path)
  //      user.path = defaultPath
  //  } while (user.path !== path.basename(user.path))
  // }
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
      url: runUrl(name, user),
      method: 'GET',
      headers: {
        'Authorization': 'UCKEY ' + user.key
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
  let url
  if (/unitcluster.com/.test(user.server)) {
    url = 'https://' + user.login + '.unit.run/' + unitName + '/logs?key=' + user.key
  } else {
    url = user.server.replace('//', '//' + user.login + '.') + unitName + '/logs?key=' + user.key
  }
  console.log('[LOG]'.red, url)
  await request(url).on('data', (chunk) => {
    console.log('[ %s-%s ]'.info, unitName, moment().format())
    console.log(chunk.toString())
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
      'Authorization': 'UCKEY ' + user.key
    },
    method: 'POST',
    form: {
      'name': unitName,
      'public': isPublic,
      'full_name': user.login + '/' + unitName
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
           'Authorization': 'UCKEY ' + user.key
         })
         .form({
           code: newCode
         })
}

function deleteDeploy (deploy, user) {
  request.delete(user.server + '/api/deployed/' + deploy.id)
         .headers({
           'Authorization': 'UCKEY ' + user.key
         })
}

async function main () {
  let unitUpdated = null
  let user
  try {
    user = await init()
  } catch (err) {
    console.log('Exiting..')
    return
  }

  if (!fs.existsSync(user.path)) {
    fs.mkdirSync(user.path)
  }
  let units = await getUnits(user)
  saveUnits(units, user.path)

  console.log('Units in', user.path, 'are now watched for changes')

  keypress(process.stdin)
  process.stdin.on('keypress', function (ch, key) {
    if (key && key.name === 'return') {
      // run unit and pipe logs
      if (unitUpdated) {
        // run unit
        runUnit(unitUpdated, user)
        console.log('[Enter]'.info, unitUpdated)
      }
    }
  })
  process.stdin.setRawMode(true)
  process.stdin.resume()

  let watcher = fs.watch(user.path, { encoding: 'UTF-8' })
  watcher.on('change', async (event, filename) => {
    if (notDuplicateEvent(filename)) {
      let filePath = path.join(user.path, filename)
      let newCode = getCode(filePath)
      let moduleName = filename.replace(/\..*/, '')
      console.log('Changes in "' + moduleName + '", updating...')
      let result = await updateUnit(moduleName, user, newCode)
      if (JSON.parse(result).code !== newCode) {
        console.error('Code not saved')
      } else {
        console.log('Press [Enter] to run unit')
        unitUpdated = moduleName
      }
    }
  })
}

main()
