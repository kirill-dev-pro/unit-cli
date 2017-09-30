#!/usr/bin/env node

const log = require('loglevel')
const Vorpal = require('vorpal')
const program = require('commander')
const Ora = require('ora')
const colors = require('colors')

const User = require('./user')
const { question, printUnits, findLocalUnit, closeReadline, getApi, createDirIfNotExist, urlConstructor } = require('./util')
const { syncUnits, createNewUnit } = require('./units')

let watched = []
let lastEvent = 0

colors.setTheme({
  warn: 'yellow',
  debug: 'blue',
  error: 'red'
})

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

async function createAndSaveUnit (user, watched, name, description, isPublic = true) {
  const spinner = new Ora('Creating unit'.debug).start()
  try {
    await createNewUnit(user, watched, name, description, isPublic)
  } catch (err) {
    log.debug(err)
    spinner.fail('Cannot create unit'.debug)
    return
  }
  spinner.succeed('Unit created at '.debug + colors.inverse(user.path + '/' + name) + ' you can edit it now'.debug)
}

async function main () {
  /**
   * Actions:
   * Sync
   * Login
   * New [unit]
   * LS
   * RM [unit]
   * Run [unit]
   */

  const handler = async (asyncFn, args, callback) => {
    try {
      await asyncFn(args)
    } catch (err) {
      log.error(err.message.error)
    }
    callback()
  }

  const syncUnitsAction = async () => {
    const spinner = new Ora('Updating units'.cyan).start()
    try {
      await syncUnits(user, watched)
    } catch (err) {
      spinner.fail(err.message).stop()
      return
    }
    spinner.succeed('Units updated'.cyan)
  }
  const printUnitsAction = (args) => printUnits(user, args.level)
  const updateUserAction = (args) => log.info(args)
  const createUnitAction = (args) => createAndSaveUnit(user, watched, args.name, args.description, args.isPrivate)
  const logArgs = args => log.info(args)
  const logUser = () => log.info(user)

  function startVorpal () {
    const vorpal = new Vorpal()
    vorpal.command('sync', 'Updates units from server')
      .action(handler.bind(this, syncUnitsAction))
    vorpal.command('login', 'Updates units from server')
      .action(handler.bind(this, updateUserAction))
    vorpal.command('new <name> [description] [isPrivate]', 'Create new unit').alias('create')
      .action(handler.bind(this, createUnitAction))
    vorpal.command('ls [level]', 'Updates units from server').alias('list')
      .action(handler.bind(this, printUnitsAction))
    vorpal.command('rm <unit>', 'Updates units from server').alias('remove')
      .action(handler.bind(this, logArgs))
    vorpal.command('run <unit>', 'Updates units from server')
      .action(handler.bind(this, logArgs))
    vorpal.command('user', 'Shows user information')
      .action(handler.bind(this, logUser))
    vorpal.delimiter('unit-cli-$').show()
  }

  log.setDefaultLevel('info')
  log.setLevel(program.loglevel)
  const user = new User()
  await user.init()
  await syncUnitsAction(user, watched)
  startVorpal()
}

main()
