const User = require('../user')
const fs = require('fs')
const {beforeAll, afterAll, test, expect} = require('jest')

beforeAll(() => {
  const defaultPath = 
  if (fs.existsSync())
})

afterAll(() => {
  
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