# `unit-cli`

## Unitluster.com command line interface :computer: 
* Create and remove units
* Edit and debug with  your favorite text editers and IDE
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
In the first run it will ask provide you account information from unitcluster.com, 
such as API token which you could find on https://unitcluster.com/account/settings and login

Create new unit with `-n [unit name]` or `--new [unit name]` option
```
unit-cli -n helloWorld
```
Then enter description and its done :rocket: 

### Basic usage
Start `unit-cli` and let it observe your files while you working. It will automaticly update your unit in the cloud 
and when you are done save local changes, switch back to console with `unit-cli` and press `Enter` button to run your unit. 
Logs and result of the unit will be printed right there
