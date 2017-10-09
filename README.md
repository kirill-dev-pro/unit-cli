![Unitcluster logo](http://oi63.tinypic.com/219ri8i.jpg)
[![Build Status](https://travis-ci.org/Zmeu213/unit-cli.svg?branch=master)](https://travis-ci.org/Zmeu213/unit-cli)
[![codecov](https://codecov.io/gh/Zmeu213/unit-cli/branch/master/graph/badge.svg)](https://codecov.io/gh/Zmeu213/unit-cli)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)


## command line interface :computer: 
* Create and remove units
* Edit and debug with your favorite text editers and IDE
* Deploy units with single button and it already working!

### Instalation
Use `npm` to install `unit-cli` globaly
```
npm i -g unit-cli
```
Then use it like any other console command
```
unit-cli
```

### Basic usage

In the first run it will ask provide you account information from unitcluster.com, 
such as API token which you could find on https://unitcluster.com/account/settings and login

First create new unit with `new [unit] [description]` command inside cli
```
unit-cli-$ new greeter-unit "Hello world unitcluster app"
```
`unit-cli` will create new folder inside your units folder that you provided at login. Also it will output to you path to this folder like this
```
✔ Unit created at /path/to/your/units/directory/greeter-unit
```
Then edit unit files. For example paste this to your `greeter-unit/index.js`
```javascript
module.exports = unit => unit.done(null, 'Hello world!')
```
Right after you save changes on your computer `unit-cli` will update unit and show you how to run it
```
✔ Press [Ctrl + R] or type [run greeter-unit] to run greeter-unit
```
Press shortcut on keybord or type `run [unit name]` to run your unit and get output from it right into your console
```
[ greeter-unit-result ] Hello world!
```
Its done :rocket: 
