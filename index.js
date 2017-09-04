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
const stream = require('stream')

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

const unitclusterUrl = 'http://vcap.me:3000/'
const runUrl = (name, login) => { return `http://${login}.vcap.me:3000/${name}`}
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

async function getApi () {
  try {
    let apiString = 'api'
    for (let arg of arguments) {
      if (typeof arg === 'string') { apiString = path.join(apiString, arg) }
    }
    let htmlString = await request(unitclusterUrl + apiString)
    return JSON.parse(htmlString)
  } catch (err) {
    console.error(err, err.stack)
  }
}

async function getUnits (login) {
  let units = await getApi('users', login, 'units')
  return units.items
}

async function getUnit (login, name) {
  let unit = getApi('units', login, name)
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

async function updateUnit (name, login, key, newCode) {
  try {
    let unit = await getUnit(login, name)
    unit.code = newCode
    let options = {
      method: 'PATCH',
      url: unitclusterUrl + path.join('api', 'units', login, name),
      headers: {
        'Authorization': 'UCKEY ' + key
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
  fs.writeFileSync(getUserHome() + '.unit-cli', JSON.stringify(user), 'utf-8')
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
  let data = fs.readFileSync(getUserHome() + '.unit-cli', 'utf-8')
  return JSON.parse(data)
}

async function init () {
  let user
  if (!fs.existsSync(getUserHome() + '.unit-cli')) {
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

// ====

async function runUnit(unitName, login) {
  if (!unitName) return
  let result
  try {
    result = await request(runUrl(unitName, login))
    printUnitLogs(unitName, login)
  } catch (errorResponse) {
    let error = JSON.parse(errorResponse.error)
    console.error('[Module %s error] '.error + error.error, unitName)
    if (error.position.line)
      console.error('at line', error.position.line)
    else 
      console.error('%s'.error, error.position)
  } finally {
    if (!result) return
    console.log('[ %s ]'.info, unitName, result)
  }
}

function printUnitLogs(unitName, login) {
  const logs = new stream()
  logs.on('data', (chunk) => {
    console.log(`Received ${chunk.length} bytes of data.`);
    console.log(chunk)
    console.log(chunk.toString)
  });
  request(runUrl(unitName, login)).pipe(logs)
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
  let units = await getUnits(user.login)
  saveUnits(units, user.path)

  console.log('Units in', user.path, 'are now watched for changes')

  keypress(process.stdin)
  process.stdin.on('keypress', function (ch, key) {
    if (key && key.name === 'return') {
      // run unit and pipe logs
      if (unitUpdated) {
        // run unit
        // console.log(unitUpdated)
        runUnit(unitUpdated, user.login)
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
      let result = await updateUnit(moduleName, user.login, user.key, newCode)
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
