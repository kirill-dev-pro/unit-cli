const { question, printUnits, findLocalUnit, closeReadline } = require('../util')

const user = {login: 'a', key: 'b', path: './units', server: 'd'}

test('print units', () => {
  expect(() => {
    printUnits()
  }).toThrow('No user')
  try {
    printUnits(user)
    printUnits(user, 1)
  } catch (err) {
    expect(err).toBeNull()
  }
})

