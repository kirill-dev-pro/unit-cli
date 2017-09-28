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
const keypress = require('keypress')
const colors = require('colors')
const _ = require('underscore')
const moment = require('moment')
const beautify = require('json-beautify')
const watch = require('node-watch')
const log = require('loglevel')
const Ora = require('ora')
const commandLineCommands = require('command-line-commands')

const User = require('./user')
const { question, printUnits, findLocalUnit, closeReadline } = require('./util')

// const PUBLIC_MODULE = true

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

let watched = []
let lastEvent = 0

program
  .version('0.1.0')
  .option('-d, --dir [dir]', 'Define path to save units')
  .option('-l, --login [login]', 'Set login to sync units from unitcluster')
  .option('-k, --key [key]', 'Set API key from your Unitcluster account')
  .option('-n, --new [unit]', 'Create new unit', '')
  .option('-s, --server [server]', 'Set server to work with')
  .option('-o, --loglevel [level]', 'Set level of logs to print [error, warn, info, debug]', 'info')
  .option('-r, --remove [unit]', 'Delete unit from unitcluster', '')
  .option('-p, --public [boolean]', 'Using with -n defines type of new unit, default true', true)
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

async function getApi (user, ...params) {
  try {
    const apiString = 'api/' + params.join('/')
    const options = {
      url: user.server + '/' + apiString,
      method: 'GET',
      headers: {
        Authorization: 'UCKEY ' + user.key
      }
    }
    log.debug(colors.red(options.method), options.url)
    const htmlString = await request(options)
    return JSON.parse(htmlString)
  } catch (err) {
    log.error(err, err.stack)
  }
}

// async function getUnitsAndDeploy (user) {
//   return await getApi(user, 'users', user.login, 'sync')
// }

// async function getAvailableUnits (user) {
//   return await getApi(user, 'units')
// }

// async function getUnit (user, name) {
//   return await getApi(user, 'units', user.login, name)
// }

function saveUnits (units, dir) {
  for (let unit of units) {
    if (unit.deploys[0]) {
      saveUnit(unit, dir)
    }
  }
}

async function updateUnits (user) {
  const getUnitsAndDeploy = async user => await getApi(user, 'users', user.login, 'sync')
  const getAvailableUnits = async user => await getApi(user, 'units')
  const appendToArray = (array, unit) => { array.push(unit.id); return array }

  const spinner = new Ora('Updating units'.cyan).start()
  let ids
  try {
    const available = (await getAvailableUnits(user)).items
    ids = available.reduce(appendToArray, [])
  } catch (err) {
    spinner.fail('Error while getting units'.error).stop()
    throw err
  }
  spinner.text = 'Saving units'.cyan
  try {
    const units = (await getUnitsAndDeploy(user)).filter(unit => ids.indexOf(unit.id) > -1)
    saveUnits(units, user.path)
  } catch (err) {
    spinner.fail('Error while saving units'.error).stop()
    throw err
  }
  spinner.succeed('Units updated'.cyan)
}

function saveUnit (unit, dir) {
  try {
    const unitPath = path.join(dir, unit.name)
    const codeFile = unitPath + '/index.js'
    const readmeFile = unitPath + '/readme.md'
    const configFile = unitPath + '/config.json'
    if (watched.indexOf(codeFile) === -1) {
      watched.push(codeFile, readmeFile, configFile)
    }
    log.debug(unitPath, codeFile)
    createUnitsPath(unitPath)
    fs.writeFileSync(codeFile, unit.code)
    fs.writeFileSync(readmeFile, unit.readme)
    saveParameters(configFile, unit.deploys[0] ? unit.deploys[0].parameters : [])
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
    log.error('Error while updating unit')
    log.debug(err, err.stack)
  }
}

function getContent (file) {
  try {
    const unit = path.parse(path.parse(file).dir).name + '/' + path.parse(file).base
    const name = path.parse(file).name
    const content = fs.readFileSync(file, 'utf-8')
    switch (name) {
      case 'index': return {code: content}
      case 'readme': return {readme: content}
      case 'config': {
        try {
          return {parameters: parseParameters(JSON.parse(content))}
        } catch (err) {
          throw err.message.replace('\n ', '').replace('JSON', unit).error
        }
      }
      default: return null
    }
  } catch (error) {
    throw error
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
  const url = urlConstructor('logs', user, unitName)
  log.debug('[LOG]'.red, url)
  const logStream = request(url)
  let lastTs = null
  logStream.on('data', (chunk) => {
    // Parse logs
    log.debug(chunk.toString())
    if (chunk.toString().substring(0, 5) === 'data:') {
      let message = JSON.parse(chunk.toString().substring(5))
      if (message.log) {
        if (lastTs !== message.ts) {
          log.info('[ %s ]'.info, message.ts)
          lastTs = message.ts
        }
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

// function updateDeploy (deploy, user, newCode) {
//   request.patch(user.server + '/api/deployed/' + deploy.id)
//     .headers({
//       Authorization: 'UCKEY ' + user.key
//     })
//     .form({
//       code: newCode
//     })
// }

// function deleteDeploy (deploy, user) {
//   request.delete(user.server + '/api/deployed/' + deploy.id)
//     .headers({
//       Authorization: 'UCKEY ' + user.key
//     })
// }

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
  // input.setRawMode(true)
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
      const file = path.parse(filePath)
      const unitName = file.dir.replace(user.path + '/', '')
      log.debug('%s changed'.debug, file.base)
      log.debug('in %s'.debug, file.dir)
      const spinner = new Ora('Updating unit ' + colors.cyan(unitName)).start()
      let content
      try {
        content = getContent(filePath)
      } catch (err) {
        spinner.fail(err)
      }
      if (content) {
        log.debug(content)
        // log.info('Changes in "'.debug + unitName + '", updating...'.debug)
        let result = await updateUnit(unitName, user, content) // here should be object like {code: "let a..."} or {readme:}
        let key = _.keys(content)[0]
        log.debug('[RESULT]'.debug, result)
        let resultState
        if (key === 'parameters') {
          resultState = compareParameters(content.parameters, JSON.parse(result).deployment.parameters)
        } else {
          resultState = JSON.parse(result)[key] !== content[key]
        }
        if (resultState) { // Sceret params are not belongs to unit but to the deployment
          spinner.fail('Unit not saved'.error)
          // log.debug('Unit not saved'.error)
        } else {
          spinner.succeed('Press ' + '[Enter]'.cyan + ' to run ' + colors.info(unitName))
          // log.info('Press', '[Enter]'.cyan, 'to run', colors.info(unitName))
          unitUpdated.name = unitName
        }
      }
    }
  })
  log.info('Watching units in %s for changes...'.cyan, user.path)
}

function checkRunUnit (unitUpdated, user) {
  if (unitUpdated.name) {
    // run unit
    runUnit(unitUpdated.name, user)
    log.debug('[Enter]'.info, unitUpdated.name)
  }
}

function parseComands (command, argv, user) {
  switch (command) {
    case 'ls':
    case 'list':
      printUnits(user, !!argv[0])
      break
    case 'rm':
    case 'remove':
      deleteUnit(user, argv)
      break
    default:
      log.warn('Wrong command')
  }
}

function deleteUnit (user, argv) {
  const deleteLocalModule = (source) => {
    try {
      fs.readdirSync(source).forEach(file => fs.unlinkSync(path.join(source, file)))
      fs.rmdirSync(source)
    } catch (err) {
      log.error('Error while deleting unit localy'.error, source)
    }
  }

  const requestDelete = (user, name) => {
    try {
      const options = {
        url: `${user.server}/api/units/${user.login}/${name}`,
        headers: {
          Authorization: 'UCKEY ' + user.key
        },
        method: 'DELETE'
      }
      request(options)
      return
    } catch (error) {
      log.error(`Error while deleting unit "${name}" from server`.error)
    }
  }

  const result = argv
    .map(arg => findLocalUnit(user, arg))
    .filter(arg => !!arg)
  result.forEach(source => requestDelete(user, path.parse(source).name))
  result.forEach(source => deleteLocalModule(source))
  if (!result.some(path => !!path)) log.warn('No units found'.yellow)
  else log.info(`Deleted ${argv.join(' ')}`.cyan)
}

function getLocalUnitsList (user) {
  log.info(1)
  const isDirectory = source => fs.lstatSync(source).isDirectory()
  const getDirectories = source => fs.readdirSync(source).map(name => path.join(source, name)).filter(isDirectory)
  return getDirectories(user.path).reduce((units, unitPath) => {
    const name = path.parse(unitPath).name
    const content = fs.readdirSync(unitPath)
    _.extend(units, {children: content})
    return units
  }, {})
}

// @TODO: store unit information

async function createNewUnit (user, name, isPublic) {
  log.info('Creating new unit', colors.green(name || ' '))
  if (!name) {
    name = await question('Unit name: ')
  }
  let unit = {
    name: name,
    language: 'javascript',
    code: '',
    readme: '',
    parameters: []
  }
  let description = await question('Unit description: ')
  let spinner = new Ora('Creating unit'.debug).start()
  let result
  try {
    result = await request
    .post({
      url: user.server + '/api/units',
      headers: {
        Authorization: 'UCKEY ' + user.key
      },
      form: {
        name: name,
        description: description,
        public: isPublic // true by default
      }
    })
    unit = JSON.parse(result)
    log.debug(result)
  } catch (error) {
    spinner.fail('Cannot create unit'.debug)
    log.trace(error)
    return false
  }
  saveUnit(unit, user.path)
  spinner.succeed('Unit created at '.debug + colors.inverse(user.path + '/' + unit.name) + ' you can edit it now'.debug)
  // log.info('Unit created at'.debug, colors.strikethrough(user.path + '/' + name), 'you can edit it now'.debug)
  // @TODO: continue improve module creating
}

async function main () {
  let unitUpdated = { name: null }
  let user = new User()
  log.setDefaultLevel('info')
  log.setLevel(program.loglevel)
  try {
    await user.init()
  } catch (err) {
    log.debug('Exiting..'.error)
    return
  }

  log.trace(colors.debug(JSON.stringify(user)))

  user.updateParameters(program)

  const validCommands = [ null, 'ls', 'list', 'rm', 'remove', 'help' ]
  const { command, argv } = commandLineCommands(validCommands)
  log.debug('command: %s', command)
  log.debug('argv:    %s', JSON.stringify(argv))
  if (command) {
    parseComands(command, argv, user)
    return
  }

  if (program.remove) {
    // @TODO: delete unit
  }

  if (program.new) {
    await createNewUnit(user, program.new, program.public) // @TODO: private modules?
  }

  try {
    createUnitsPath(user.path)
  } catch (e) {
    log.error(e)
    return
  }

  try {
    await updateUnits(user)
  } catch (err) {
    log.debug(err)
    return
  }

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

  closeReadline()
}

main()
