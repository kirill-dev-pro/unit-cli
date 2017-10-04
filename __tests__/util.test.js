const { urlConstructor, findLocalUnit } = require('../util')

const user = {login: 'user', key: 'key', path: './tmp', server: 'server.org'}

beforeAll(() => {
  require('mkdirp').sync(user.path + '/some-real-unit')
})

afterAll(() => {
  require('fs').rmdirSync(user.path + '/some-real-unit')
  require('fs').rmdirSync(user.path)
})

test('Test to construct url', () => {
  let url = urlConstructor('logs', user, 'test')
  expect(url).toBe('server.org/test/logs?key=key')
})

describe('Find unit', () => {
  test('Find no unit', () => {
    const unit = findLocalUnit(user, 'some-unit')
    expect(unit).toBe(undefined)
  })

  test('Find unit and return its name', () => {
    const unit = findLocalUnit(user, 'some-real-unit')
    expect(unit).toBe('tmp/some-real-unit')
  })
})

