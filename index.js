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

const unitclusterUrl = 'http://vcap.me:3000/'
let watched = []
let lastEvent = 0

program
  .version('0.1.0')
  .option('-d, --dir [dir]', 'Name a dir [current]', './units')
  .option('-l, --login [login]', 'Set login to sync units from unitcluster')
  .option('-k, --key [key]', 'Set API key from your Unitcluster account')
  .option('-n, --new [unit]', 'Create new unit')
  .parse(process.argv)

async function getApi() {
	try {
		let apiString = 'api'
		for (let arg of arguments) {
			if (typeof arg == 'string')
				apiString = path.join(apiString, arg)
		}
		let htmlString = await request(unitclusterUrl + apiString)
		return JSON.parse(htmlString)
	} catch (err) {
		console.error(err, err.stack)
	}
}

async function getUnits(login) {
	let units = await getApi('users', login, 'units')
	return units.items
}

async function getUnit(login, name) {
	let unit = getApi('units', login, name)
	return unit
}

function saveUnits(units, dir) {
	for (unit of units) {
		saveUnit(unit, dir)
	}
}

function saveUnit(unit, dir) {
	try {
		let filePath = path.join(dir, unit.name)
		if (unit.language == 'javascript') {
			filePath+='.js'
			if (watched.indexOf(unit.name) == -1) {
				watched.push(unit.name + '.js')
			}
		}
		// let file = fs.open(filePath)
		fs.writeFileSync(filePath, unit.code)
	} catch (err) {
		console.error(err, err.stack)
	}
}

async function updateUnit(name, login, key, newCode) {
	try {
		let unit = await getUnit(login, name)
		unit.code = newCode
		let options = {
			method: "PATCH",
			url: unitclusterUrl + path.join('api', 'units', login, name),
			headers: {
				"Authorization": "UCKEY " + key
			},
			form: {code: newCode}
		}
		return await request(options)
	} catch (err) {
		console.error(err, err.stack)
	}
}

function getCode(file) {
	let code = fs.readFileSync(file, 'utf-8')
	return code
}

//If not duplicate and unit file
function notDuplicateEvent(filename) {
	let current = Math.floor(new Date() / 1000)
	if (watched.indexOf(filename) > -1 && lastEvent + 3 < current) {
		lastEvent = current
		return true
	} else {
		return false
	}
}

async function main() {
	let login = program.login,
	    key = program.key
	if (program.new) {
		await createNewUnit(login, key, program.new)
	}
	if (login) {
		// console.log(program.login)
		let dir = path.join(__dirname, program.dir)
		console.log('Yor dir:', dir)
		if (!fs.existsSync(dir)) {
		  fs.mkdirSync(dir)
		}
		let units = await getUnits(program.login)
		saveUnits(units, dir)

		let watcher = fs.watch(dir, { encoding: 'UTF-8' })
		watcher.on('change', async (event, filename)=>{
			if (notDuplicateEvent(filename)) {
				let filePath = path.join(dir, filename)
				let newCode = getCode(filePath)
				let moduleName = filename.replace(/\..*/,'')
				let result = await updateUnit(moduleName, login, key, newCode)
				if (JSON.parse(result).code != newCode) {
					console.error('Code not saved')
				}
			}
			// do stuff like update
		})
	}
}

main()