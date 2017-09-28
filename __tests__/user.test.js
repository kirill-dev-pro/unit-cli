const User = require('../user')
const fs = require('fs')
// const {beforeAll, afterAll, test, expect} = require('jest')
const defaultPath = process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME']
const testUser = { user: {
  login: 'aaa',
  key: 'bbb',
  server: 'ccc',
  path: defaultPath + '/units'
}}

beforeAll(() => {
  if (fs.existsSync(defaultPath + '/.unit-cli.json')) {
    fs.renameSync(defaultPath + '/.unit-cli.json', defaultPath + '/.unit-cli.json.backup')
  }
  fs.writeFileSync(defaultPath + '/.unit-cli.json', JSON.stringify(testUser), 'utf-8')
})

afterAll(() => {
  fs.unlinkSync(defaultPath + '/.unit-cli.json')
  if (fs.existsSync(defaultPath + '/.unit-cli.json.backup')) {
    fs.renameSync(defaultPath + '/.unit-cli.json.backup', defaultPath + '/.unit-cli.json')
  }
})

test('creates user', () => {
  const user = new User()
  expect(user).toEqual({})
})

test('init', async () => {
  const user = new User()
  await user.init()
  expect.objectContaining({
    login: expect.any(String),
    key: expect.any(String),
    path: expect.any(String),
    server: expect.any(String)
  })
})
