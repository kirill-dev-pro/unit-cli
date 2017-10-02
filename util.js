const Readline = require('readline')
const FileHound = require('filehound')
const log = require('loglevel')
const path = require('path')
const colors = require('colors')
const request = require('request-promise-native')
const fs = require('fs')

let readline = {}

module.exports.closeReadline = () => {
  readline.close()
}

const authUser = (user) => ({Authorization: 'UCKEY ' + user.key})
module.exports.authUser = authUser

module.exports.getUserConfigPath = () => {
  return process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'] + '/.unit-cli.json'
}

const startReadline = Readline => Readline.createInterface({ input: process.stdin, output: process.stdout })
const stopReadline = readline => readline.close()

module.exports.question = (question) => {
  return new Promise((resolve) => {
    readline = startReadline(Readline)
    readline.question(question, (answer) => {
      // readline.pause()
      stopReadline(readline)
      resolve(answer)
    })
  })
}

module.exports.findLocalUnit = (user, name) => {
  return FileHound.create()
    .path(user.path)
    .ignoreHiddenDirectories()
    .glob(name)
    .directory()
    .findSync()
    .shift()
}

module.exports.getApi = async (user, ...params) => {
  try {
    const options = {
      url: user.server + '/api/' + params.join('/'),
      method: 'GET',
      headers: authUser(user)
    }
    log.debug(colors.red(options.method), options.url)
    return JSON.parse(await request(options))
  } catch (err) {
    throw err
  }
}

module.exports.createDirIfNotExist = (path) => {
  try {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path)
    }
  } catch (err) {
    log.error(err, err.stack)
    throw new Error('Cannot create directory, check permisions')
  }
}

module.exports.urlConstructor = (type, user, name) => {
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

module.exports.notDuplicateEvent = (filePath, watched, lastEvent) => {
  const currentTime = Math.floor(new Date() / 1000)
  return watched.indexOf(filePath) > -1 && lastEvent + 3 < currentTime
}

module.exports.getContent = (file) => {
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

module.exports.compareParameters = (params1, params2) => {
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

