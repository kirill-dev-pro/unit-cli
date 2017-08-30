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

const unitclusterUrl = 'https://unitcluster.com/'
let watched = []

program
  .version('0.1.0')
  .option('-d, --dir [dir]', 'Name a dir [current]', './units')
  .option('-l, --login [login]', 'Set login to sync units from unitcluster')
  .parse(process.argv)

async function callApi() {
	try {
		let apiString = 'api'
		for (let arg of arguments) {
			path.join(apiString, arg)
		}
		let htmlString = await request(unitclusterUrl + apiString)
		return JSON.stringify(htmlString)
	} catch (err) {
		console.error(err, err.stack)
	}
}

async function getUnits(login) {
	let units = await callApi('users', login, 'units')
	// let htmlString = await request(unitclusterUrl + path.join('api', 'users', login, 'units'))
	// units = JSON.parse(htmlString)
	// console.log(units.stats)
	return units.items
}

async function getUnit(login, name) {
	let unit = callApi('units', login, name)
	// let htmlString = await request(unitclusterUrl + path.join('api', 'units', login, name))
	// unit = JSON.parse(htmlString)
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
		}
		// let file = fs.open(filePath)
		fs.writeFileSync(filePath, unit.code)
	} catch (err) {
		console.error(err, err.stack)
	}
}

async function updateUnit(name, newCode) {
	try {
		let unit = await getUnit(login, name)
		unit.code = newCode
		await callApi('units', login, name)
		await request(unitclusterUrl + path.join('api', 'units', login, name))
	} catch (err) {
		console.error(err, err.stack)
	}
}

async function main() {
	if (program.login) {
		// console.log(program.login)
		let dir = path.join(__dirname, program.dir)
		console.log('Yor dir:', dir)
		if (!fs.existsSync(dir)) {
		  fs.mkdirSync(dir)
		}
		let units = await getUnits(program.login)
		saveUnits(units, dir)

		let watcher = fs.watch(dir, { encoding: 'UTF-8' })
		watcher.on('change', (event, filename)=>{
			console.log(event, filename)
			// do stuff like update
		})
	}
}

main()