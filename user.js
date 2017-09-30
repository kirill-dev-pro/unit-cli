const fs = require('fs')
const path = require('path')
const _ = require('underscore')
const log = require('loglevel')
const { question, getUserConfigPath } = require('./util')

module.exports = class User {
  getUserConfigPath () {
    return process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'] + '/.unit-cli.json'
  }

  async init () {
    if (!fs.existsSync(getUserConfigPath())) {
      await this.askUserToLogin()
    } else {
      this.load()
    }
    if (!this.login || !this.key) {
      throw new Error('User import error')
    }
  }

  load () {
    try {
      let data = fs.readFileSync(this.getUserConfigPath(), 'utf-8')
      let obj = JSON.parse(data)
      for (let pair of _.pairs(obj.user)) {
        this[pair[0]] = pair[1]
      }
    } catch (error) {
      log.error('Error while reading config')
    }
  }

  async askUserToLogin () {
    let defaultPath = path.join(process.cwd(), 'units')
    log.info('Hi! It seems you try to start Unit-cli first time')
    log.info('Enter your UnitCluster login and API key ')
    this.login = await question('Login: ')
    this.key = await question('API key: ')
    this.path = await question('Folder to sync your units to [' + defaultPath + ']: ')
    if (!this.path) {
      this.path = defaultPath
    }
    // we dont need another server, anyway it could be changed by -s parameter
    // user.server = await question('Enter your server [ https://unitcluster.com ]: ')
    if (!this.server) {
      this.server = 'https://unitcluster.com'
    }
    this.save()
  }

  save () {
    const configExist = fs.existsSync(getUserConfigPath())
    const readConfig = () => JSON.parse(fs.readFileSync(this.getUserConfigPath(), 'utf-8'))
    const config = configExist ? readConfig() : {}
    config.user = this
    fs.writeFileSync(this.getUserConfigPath(), JSON.stringify(config), 'utf-8')
  }

  updateParameters (config) {
    if (config.dir || config.key || config.login) {
      if (config.dir) {
        this.path = config.dir
      }
      if (config.key) {
        this.key = config.key
      }
      if (config.login) {
        this.login = config.login
      }
      if (config.server) {
        this.server = config.server
      }
      this.save()
    }
  }
}
