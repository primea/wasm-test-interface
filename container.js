// mock container tested with binaryen wasm examples,
// to be changed to martin's version
const EVMInterface = require('./EVMInterface')

module.exports = class ewasmContainer {
  constructor(code, kernel) {
    this.kernel = kernel // mocked
    this.module = WebAssembly.Module(code)
  }

  async run(message) {
    const evmInterface = new EVMInterface(message, exoInterface)
    const instance = WebAssembly.Instance(this.module, evmInterface)
    evmInterface.setMemory(new Uint8Array(instance.exports.memory.buffer))
    return instance.exports.main()
  }

  static register(namespace, iface) {
    this[namespace] = iface
  }
}
