#!/usr/bin/env node

const log = require('loglevel')
const Vorpal = require('vorpal')
const program = require('commander')
const Ora = require('ora')
const colors = require('colors')
const watch = require('node-watch')
const path = require('path')
const _ = require('underscore')

const User = require('./user')
const { notDuplicateEvent, getContent, compareParameters } = require('./util')
const { printUnits, syncUnits, createNewUnit, updateUnit, deleteUnit } = require('./units')

let watched = []
let watcher
let lastEvent = 0
let unitUpdated = { name: null }

colors.setTheme({
  warn: 'yellow',
  debug: 'blue',
  error: 'red'
})

program
  .version('0.1.0')
  .option('--no-sync', 'Disable sync at start', false)
  .option('-d, --dir [dir]', 'Define path to save units')
  .option('-l, --login [login]', 'Set login to sync units from unitcluster')
  .option('-k, --key [key]', 'Set API key from your Unitcluster account')
  .option('-n, --new [unit]', 'Create new unit', '')
  .option('-s, --server [server]', 'Set server to work with')
  .option('-o, --loglevel [level]', 'Set level of logs to print [error, warn, info, debug]', 'info')
  .option('-r, --remove [unit]', 'Delete unit from unitcluster', '')
  .option('-p, --public [boolean]', 'Using with -n defines type of new unit, default true', true)
  .parse(process.argv)

function watchUnits (user, unitUpdated, vorpal) {
  const watcher = watch(user.path, { recursive: true }, async (evt, filePath) => {
    if (notDuplicateEvent(filePath, watched, lastEvent)) {
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
        return vorpal.show()
      }
      if (content) {
        log.debug(content)
        // log.info('Changes in "'.debug + unitName + '", updating...'.debug)
        let result
        try {
          result = await updateUnit(unitName, user, content) // here should be object like {code: "let a..."} or {readme:}
        } catch (err) {
          spinner.fail(err).stop()
          return vorpal.show()
        }
        let key = _.keys(content)[0]
        log.debug('[RESULT]'.debug, result)
        let resultState
        if (key === 'parameters') {
          resultState = compareParameters(content.parameters, JSON.parse(result).deployment.parameters)
        } else {
          resultState = JSON.parse(result)[key] !== content[key]
        }
        if (resultState) { // Secret params are not belongs to unit but to the deployment
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
  return watcher
}

const spinnerWrap = async (startMessage, successMessage, asyncFn, ...params) => {
  const spinner = new Ora(startMessage.cyan).start()
  let result
  try {
    result = await asyncFn.apply(null, params)
  } catch (err) {
    spinner.fail(err.message.debug).stop()
    return
  }
  spinner.succeed(typeof successMessage === 'function' ? successMessage(result).cyan : successMessage.cyan)
}

const pauseWatcherWrap = async (watcher, fn, reopenWatcher) => {
  if (watcher) {
    if (!watcher.isClosed()) watcher.close()
  }
  await fn()
  if (reopenWatcher) watcher = reopenWatcher()
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

  const deleteUnitAction = args => spinnerWrap('Deleting...', (units) => `Deleted ${units}`, deleteUnit, user, args.units)
  const syncUnitsAction = async () => pauseWatcherWrap(watcher, spinnerWrap.bind(null, 'Updating units', 'Units updated', syncUnits, user, watched),
                                                      watchUnits.bind(null, user, unitUpdated, vorpal)) // yeah, complicated
  const createUnitAction = async (args) => spinnerWrap('Creating unit', (path) => `Unit created at ${path}`,
                                                        createNewUnit, user, watched, args.name, args.description, args.isPrivate)
  const printUnitsAction = (args) => printUnits(user, args.level)
  const updateUserAction = (args) => log.info(args)
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
    vorpal.command('rm <units...>', 'Updates units from server').alias('remove')
      .action(handler.bind(this, deleteUnitAction))
    vorpal.command('run <unit>', 'Updates units from server')
      .action(handler.bind(this, logArgs))
    vorpal.command('user', 'Shows user information')
      .action(handler.bind(this, logUser))
    vorpal.delimiter('unit-cli-$')
    return vorpal
  }

  log.setDefaultLevel('info')
  log.setLevel(program.loglevel)
  const user = new User()
  await user.init()
  if (program.sync) await syncUnitsAction(user, watched)
  const vorpal = startVorpal()
  watcher = watchUnits(user, unitUpdated, vorpal)
  vorpal.show()
}

main()
