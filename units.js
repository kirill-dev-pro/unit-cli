const fs = require('fs')
const path = require('path')
const beautify = require('json-beautify')
const log = require('loglevel')
const request = require('request-promise-native')
const tree = require('tree-tree')
const FileHound = require('filehound')
const moment = require('moment')
const _ = require('underscore')

const { getApi, createDirIfNotExist, findLocalUnit, urlConstructor, authUser } = require('./util')

module.exports.syncUnits = async (user, watched) => {
  const saveUnits = (units, dir, watched) => units.forEach(unit => saveUnit(unit, dir, watched))
  const getUnitsAndDeploy = async user => await getApi(user, 'users', user.login, 'sync')
  const getAvailableUnits = async user => await getApi(user, 'units')
  const appendToArray = (array, unit) => { array.push(unit.id); return array }

  let ids
  try {
    createDirIfNotExist(user.path)
  } catch (error) {
    throw error
  }
  try {
    const available = (await getAvailableUnits(user)).items
    ids = available.reduce(appendToArray, [])
  } catch (err) {
    throw new Error('Error while getting units. ' + err.message)
  }
  try {
    const units = (await getUnitsAndDeploy(user)).filter(unit => ids.indexOf(unit.id) > -1)
    saveUnits(units, user.path, watched)
  } catch (err) {
    throw new Error('Error while saving units. ' + err.message)
  }
}

function saveUnit (unit, dir, watched) {
  try {
    const unitPath = path.join(dir, unit.name)
    const codeFile = unitPath + '/index.js'
    const readmeFile = unitPath + '/readme.md'
    const configFile = unitPath + '/config.json'
    if (watched.indexOf(codeFile) === -1) {
      watched.push(codeFile, readmeFile, configFile)
    }
    log.debug(unitPath, codeFile)
    createDirIfNotExist(unitPath)
    fs.writeFileSync(codeFile, unit.code)
    fs.writeFileSync(readmeFile, unit.readme)
    saveParameters(configFile, unit.deploys && unit.deploys[0] ? unit.deploys[0].parameters : [])
  } catch (err) {
    log.debug(err.message.error)
    throw err
  }
}

function saveParameters (path, parameters) {
  try {
    let config = { secret: {}, public: {} }
    const addToParams = param => { config[param.type][param.name] = param.value }
    parameters.filter(param => param && param.name).forEach(addToParams)
    fs.writeFileSync(path, beautify(config, null, 2, 10)) // magic numbers
  } catch (err) {
    throw err
  }
}

module.exports.createNewUnit = async (user, watched, name, description = '', isPublic = true) => {
  // const parseErrorFromServer = (err) =>
  if (!name) throw new Error('No name to create unit')
  let unit = {
    name: name,
    language: 'javascript',
    code: '',
    readme: '',
    parameters: []
  }
  try {
    const result = await request
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
    saveUnit(unit, user.path, watched)
    log.debug(typeof result)
    return user.path + '/' + unit.name // return path to unit
  } catch (error) {
    log.debug(error)
    if (error.name === 'StatusCodeError') {
      const messageObj = JSON.parse(JSON.parse(error.message.replace(/.*?"/, '"'))) // dont ask me why
      throw new Error(messageObj.message)
    }
    throw new Error('Cannot create unit. ' + error.message)
  }
  // log.info('Unit created at'.debug, colors.strikethrough(user.path + '/' + name), 'you can edit it now'.debug)
  // @TODO: continue improve module creating
}

module.exports.printUnits = (user, level = 0) => {
  const toObject = (name, children = []) => ({ name: name, children: children })
  const getSubFiles = (path) => FileHound.create().path(path).findSync()
  const getLocalUnitsList = (user) => FileHound.create().paths(user.path).directory().findSync()

  if (!user) throw new Error('No user')
  const units = getLocalUnitsList(user)
  const list = units.reduce((list, source) => {
    const name = path.parse(source).name
    const children = level ? getSubFiles(source).map(file => toObject(path.parse(file).base)) : []
    list.push(toObject(name, children))
    return list
  }, [])
  try {
    log.info(tree(toObject(`[${user.login}] ${user.path}`.cyan, list)))
  } catch (err) {
    log.error(err)
  }
}

module.exports.updateUnit = async (unitName, user, newContent) => {
  try {
    const deploy = await getDeploy(unitName, user) || await createNewDeploy(unitName, user, false)
    log.debug('[CONTENT]'.debug, newContent)
    log.debug('[DEPLOY]'.debug, JSON.stringify(deploy))
    if (!deploy.unit) {  // deploy from create deploy does not contan unit, @BUG
      deploy.unit = {
        code: deploy.code,
        parameters: deploy.parameters,
        readme: ''
      }
    }
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
    options.form.parameters = options.form.parameters.map(param => _.pick(param, 'name', 'type', 'value')) // clean params
    log.debug('[OPTIONS]'.debug, options)
    return await request(options)
  } catch (err) {
    if (err.message === 'No deploy for unit') throw err
    log.debug(err, err.stack)
    throw new Error('Error while updating unit. ' + err.message)
  }
}

async function getDeploy (unitName, user = []) {
  let deploys = await getApi(user, 'units', user.login, unitName, 'deployed')
  if (deploys.stats > 0) {
    return deploys.units[0]
  } else {
    return null
  }
}

module.exports.deleteUnit = (user, argsArray) => {
  const deleteLocalModule = (source) => {
    try {
      fs.readdirSync(source).forEach(file => fs.unlinkSync(path.join(source, file)))
      fs.rmdirSync(source)
    } catch (err) {
      throw new Error('Error while deleting unit localy. ' + err.message)
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
      throw new Error(`Error while deleting unit "${name}" from server`)
    }
  }

  const result = argsArray
    .map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg))
    .map(arg => findLocalUnit(user, arg))
    .filter(arg => !!arg)
  result.forEach(source => requestDelete(user, path.parse(source).name))
  result.forEach(source => deleteLocalModule(source))
  if (!result.some(path => !!path)) throw new Error('No units found'.yellow)
  else return argsArray.join(' ')
}

module.exports.runUnit = async (user, unitName) => {
  // get deploy name
  // run deploy
  // get logs from deploy

  if (!unitName || !findLocalUnit(user, unitName)) throw new Error('No such unit')
  let deploy = await getDeploy(unitName, user)
  if (!deploy) {
    // create new deploy
    deploy = await createNewDeploy(unitName, user, false) // public: false
  }
  printUnitLogs(deploy.name, user)
  runDeploy(deploy.name, user)
}

async function createNewDeploy (unitName, user, isPublic) {
  let options = {
    url: `${user.server}/api/units/${user.login}/${unitName}/deploy`,
    headers: authUser(user),
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

async function runDeploy (name, user) {
  if (!name) return
  log.debug('[RUN UNIT]'.debug, name)
  let result
  try {
    const options = {
      url: urlConstructor('run', user, name),
      method: 'GET',
      headers: authUser(user)
    }
    log.debug('GET'.red, options.url)
    try {
      result = await request(options)
    } catch (requestError) {
      const error = JSON.parse(requestError.error)
      log.error('[Module %s error] '.error + error.error, name)
      if (error.position.line) { log.error('at line', error.position.line) } else { log.error('%s'.error, error.position) }
    }
  } catch (error) {
    log.error(error)
  }
  if (!result) return
  log.info('[ %s-result ]'.green, name, result)
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
          log.info('[ %s ]'.green, message.ts)
          lastTs = message.ts
        }
        log.info('[ %s ] :'.green, message.slot, message.log)
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
