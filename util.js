const Readline = require('readline')
const tree = require('tree-tree')
const FileHound = require('filehound')
const log = require('loglevel')
const path = require('path')

module.exports.getUserConfigPath = () => {
  return process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'] + '/.unit-cli.json'
}

const readline = Readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

module.exports.question = (question) => {
  return new Promise((resolve) => {
    readline.question(question, (answer) => {
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

module.exports.printUnits = (user, level) => {
  const toObject = (name, children) => {
    if (children != null) {
      return { name: name, children: children }
    } else {
      return { name: name }
    }
  }

  function getSubFiles (path) {
    return FileHound.create()
      .path(path)
      .findSync()
  }

  function getLocalUnitsList (user) {
    return FileHound.create()
      .paths(user.path)
      .directory()
      .findSync()
  }

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