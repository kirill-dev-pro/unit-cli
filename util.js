const Readline = require('readline')
const tree = require('tree-tree')
const FileHound = require('filehound')
const log = require('loglevel')
const path = require('path')
const colors = require('colors')
const request = require('request-promise-native')
const fs = require('fs')

module.exports.getUserConfigPath = () => {
  return process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'] + '/.unit-cli.json'
}

let readline = {}
//  = Readline.createInterface({
//   input: process.stdin,
//   output: process.stdout
// })
// readline.pause()

module.exports.closeReadline = () => {
  readline.close()
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
    log.info(tree(toObject(user.login.cyan, list)))
  } catch (err) {
    log.error(err)
  }
}

module.exports.getApi = async (user, ...params) => {
  try {
    const options = {
      url: user.server + '/api/' + params.join('/'),
      method: 'GET',
      headers: {
        Authorization: 'UCKEY ' + user.key
      }
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
