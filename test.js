const fs = require('fs')
const ewasmContainer = require('./container.js')

const ewasmCode = fs.readFileSync('./hello2.wasm')
const exoInterface = 'my mocked kernel'

const containerInstance = new ewasmContainer(ewasmCode, exoInterface)

containerInstance.run().catch((e) => console.log(e))
