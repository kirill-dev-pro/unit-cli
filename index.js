#!/usr/bin/env node

const log = require('loglevel')
const Vorpal = require('vorpal')
const program = require('commander')
const Ora = require('ora')
const colors = require('colors')
const watch = require('node-watch')
const path = require('path')
const _ = require('underscore')
const commandLineCommands = require('command-line-commands')

const validCommands = [ null, 'sync', 'new', 'run', 'rm', 'remove', 'ls', 'list' ]
const { command, argv } = commandLineCommands(validCommands)

const User = require('./user')
const { notDuplicateEvent, getContent, compareParameters } = require('./util')
const { printUnits, syncUnits, createNewUnit, updateUnit, deleteUnit, runUnit } = require('./units')
const info = require('./package.json')

let watched = []
let watcher = {fileHound: null}
let lastEvent = 0
let unitUpdated = { name: null }

colors.setTheme({
  warn: 'yellow',
  debug: 'blue',
  error: 'red'
})

program
  .version(info.version)
  // .option('--no-sync', 'Disable sync at start', false)  // disabled for capability
  .option('-d, --dir [dir]', 'Define path to save units')
  .option('-l, --login [login]', 'Set login to sync units from unitcluster')
  .option('-k, --key [key]', 'Set API key from your Unitcluster account')
  .option('-n, --new [unit]', 'Create new unit', '')
  .option('-s, --server [server]', 'Set server to work with')
  .option('-o, --loglevel [level]', 'Set level of logs to print [error, warn, info, debug]', 'info')
  .option('-r, --remove [unit]', 'Delete unit from unitcluster', '')
  .option('-p, --public [boolean]', 'Using with -n defines type of new unit, default true', true)
  .parse(process.argv)

const sleep = time => { return new Promise(resolve => setTimeout(() => { resolve() }, time)) }

async function watchUnits (user, unitUpdated, vorpal) {
  await sleep(100)
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
          spinner.succeed(`Press ${'[Ctrl + R]'.cyan} or type ${`[run ${unitName}]`.cyan} to run ${unitName.green}`)
          // log.info('Press', '[Enter]'.cyan, 'to run', colors.info(unitName))
          unitUpdated.name = unitName
          vorpal.show()
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

const setShortcuts = user => process.stdin.on('keypress', (key, param) => {
  if (param.name === 'r' && param.ctrl) {
    if (unitUpdated.name) {
      try {
        runUnit(user, unitUpdated.name)
      } catch (error) {
        log.error(error)
      }
    }
  }
  if (param.name === 'd' && param.ctrl) {
    console.log('\nBye!')
    process.exit()
  }
})

const pauseWatcherWrap = async (fn, reopenWatcher, watcher) => {
  if (watcher.fileHound) {
    if (!watcher.fileHound.isClosed()) watcher.fileHound.close()
  }
  await fn()
  if (reopenWatcher) watcher.fileHound = await reopenWatcher()
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

  let vorpal

  const deleteUnitAction = args => spinnerWrap('Deleting...', (units) => `Deleted ${units}`, deleteUnit, user, args.units)
  const syncUnitsAction = () => pauseWatcherWrap(spinnerWrap.bind(null, 'Updating units', 'Units updated', syncUnits, user, watched),
                                                      watchUnits.bind(null, user, unitUpdated, vorpal), watcher) // yeah, complicated
  const createUnitAction = (args) => spinnerWrap('Creating unit', (path) => `Unit created at ${path}`,
                                                        createNewUnit, user, watched, args.name, args.description, args.isPrivate)
  const printUnitsAction = (args) => printUnits(user, args.level)
  const updateUserAction = (args) => log.info(args)
  const logArgs = args => log.info(args.message)
  const printUserAction = () => log.info(user)
  const runUnitAction = (args) => runUnit.call(this, user, args.unit) // tryCatchWrap(runUnit.bind(this, user, args.unit))

  function startVorpal () {
    const vorpal = new Vorpal()
    vorpal.command('sync', 'Update units from server')
      .action(handler.bind(this, syncUnitsAction))
    vorpal.command('login', 'Login to unitcluster')
      .action(handler.bind(this, updateUserAction))
    vorpal.command('new <name> [description] [isPrivate]', 'Create new unit').alias('create')
      .action(handler.bind(this, createUnitAction))
    vorpal.command('ls [level]', 'Prints all units and files if level is defined').alias('list')
      .action(handler.bind(this, printUnitsAction))
    vorpal.command('rm <units...>', 'Delete unit').alias('remove')
      .action(handler.bind(this, deleteUnitAction))
    vorpal.command('run <unit>', 'Run unit and view logs in console')
      .action(handler.bind(vorpal, runUnitAction))
    vorpal.command('user', 'Show user information')
      .action(handler.bind(this, printUserAction))
    vorpal.command('echo [message]', 'Repeat providen message')
      .action(handler.bind(this, logArgs))
    vorpal.delimiter('unit-cli-$')
    return vorpal
  }

  async function checkCommands (user) {
    log.debug(command, argv[0], argv[1], argv[2])
    switch (command) {
      case 'sync': {
        await spinnerWrap('Updating units', 'Units updated', syncUnits, user, watched)
        return 1
      }
      case 'new': {
        await createUnitAction({name: argv[0], description: argv[1], isPrivate: argv[2]})
        return 1
      }
      case 'ls':
      case 'list': {
        printUnitsAction({level: argv[0]})
        return 1
      }
      case 'rm':
      case 'remove': {
        await deleteUnitAction({units: argv})
        return 1
      }
      case 'run': {
        runUnitAction({unit: argv[0]})
        return 0
      }
      case null:
      default: return -1
    }
  }

  vorpal = startVorpal()
  log.methodFactory = (methodName, logLevel, loggerName) => (...params) => vorpal.log(...params)
  log.setDefaultLevel('info')
  log.setLevel(program.loglevel)
  const user = new User()
  await user.init()
  setShortcuts(user)
  const state = await checkCommands(user)
  if (state === -1) {
    await syncUnitsAction(user, watched)
    vorpal.show()
  } else if (state === 1) {
    log.info('All done')
    process.exit()
  } else if (state === 0) {
    vorpal.show()
  }
}

main()
