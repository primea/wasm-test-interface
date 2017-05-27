// TODO figure about how to pass exoInterface here
const ethUtil = require('ethereumjs-util')
const Vertex = require('merkle-trie')
const U256 = require('fixed-bn.js').U256
const U128 = require('fixed-bn.js').U128
const Message = require('./message.js')
const common = require('./common.js')

const U128_SIZE_BYTES = 16
const ADDRESS_SIZE_BYTES = 20
const U256_SIZE_BYTES = 32

module.exports = class EVMInterface {
  constructor (message, exoInterface) {
    this.message = message
    this.exoInterface = exoInterface
    this.port = -1 // gets written in run()
    const gasCosts = {
      // include all the public bodys according to the Ethereum Environment Interface (EEI) r1
      'getAddress': 2,
      'getBalance': 20,
      'getTxOrigin': 2,
      'getCaller': 2,
      'getCallValue': 2,
      'getCallDataSize': 2,
      'callDataCopy': 0,
      'callDataCopy256': 3,
      'getCodeSize': 2,
      'codeCopy': 0,
      'getExternalCodeSize': 20,
      'externalCodeCopy': 0,
      'getTxGasPrice': 2,
      'getBlockHash': 20,
      'getBlockCoinbase': 2,
      'getBlockTimestamp': 2,
      'getBlockNumber': 2,
      'getBlockDifficulty': 2,
      'getBlockGasLimit': 2,
      'log': 0,
      'create': 32000,
      'callCode': 40,
      'callDelegate': 40,
      'storageStore': 5000,
      'storageLoad': 50,
      'return': 2,
      'selfDestruct': 2
    }

    for (let e in gasCosts) {
      const t = {body: this[e], cost: gasCosts[e]}
      this[e] = function () {
        this.takeGas(t.cost)
        this.apply(t.body, arguments)
      }
    }
  }

  /**
   * Gets address of currently executing account and loads it into memory at
   * the given offset.
   * @param {integer} offset
   */
  getAddress (offset) {
    const path = this.exoInterface.path
    this.memoryWrite(offset, ADDRESS_SIZE_BYTES, Buffer.from(path[1].slice(2), 'hex'))
  }

  /**
   * Gets balance of the given account and loads it into memory at the given
   * offset.
   * @param {integer} addressOffset the memory offset to laod the address
   * @param {integer} resultOffset
   */
  async getBalance (addressOffset, offset, cbIndex) {
    const path = [common.PARENT, common.PARENT, '0x' + Buffer.from(this.getMemory(addressOffset, ADDRESS_SIZE_BYTES)).toString('hex')]
    const port = this.exoInterface.ports.get(path)
    const balance = await this.exoInterface.send(port, new Message({
      to: path,
      data: {
        getValue: 'balance'
      },
      sync: true
    }))
      .catch(() => Buffer.from([]))

    this.memoryWrite(offset, U128_SIZE_BYTES, new U128(balance).toBuffer())
  }

  /**
   * Gets the execution's origination address and loads it into memory at the
   * given offset. This is the sender of original transaction; it is never an
   * account with non-empty associated code.
   * @param {integer} offset
   */
  getTxOrigin (offset) {
    const origin = Buffer.from(this.message.from[2].slice(2), 'hex')
    this.memoryWrite(offset, ADDRESS_SIZE_BYTES, origin)
  }

  /**
   * Gets caller address and loads it into memory at the given offset. This is
   * the address of the account that is directly responsible for this execution.
   * @param {integer} offset
   */
  getCaller (offset) {
    const caller = this.message.from[2]
    this.memoryWrite(offset, ADDRESS_SIZE_BYTES, Buffer.from(caller.slice(2), 'hex'))
  }

  /**
   * Gets the deposited value by the instruction/transaction responsible for
   * this execution and loads it into memory at the given location.
   * @param {integer} offset
   */
  getCallValue (offset) {
    this.memoryWrite(offset, U128_SIZE_BYTES, this.message.value.toBuffer())
  }

  /**
   * Get size of input data in current environment. This pertains to the input
   * data passed with the message call instruction or transaction.
   * @return {integer}
   */
  getCallDataSize () {
    return this.message.data.length
  }

  /**
   * Copys the input data in current environment to memory. This pertains to
   * the input data passed with the message call instruction or transaction.
   * @param {integer} offset the offset in memory to load into
   * @param {integer} dataOffset the offset in the input data
   * @param {integer} length the length of data to copy
   */
  callDataCopy (offset, dataOffset, length) {
    this.takeGas(3 + Math.ceil(length / 32) * 3)
    if (length) {
      const callData = this.message.data.slice(dataOffset, dataOffset + length)
      this.memoryWrite(offset, length, callData)
    }
  }

  /**
   * Copys the input data in current environment to memory. This pertains to
   * the input data passed with the message call instruction or transaction.
   * @param {integer} offset the offset in memory to load into
   * @param {integer} dataOffset the offset in the input data
   */
  callDataCopy256 (offset, dataOffset) {
    const callData = this.message.data.slice(dataOffset, dataOffset + 32)
    this.memoryWrite(offset, U256_SIZE_BYTES, callData)
  }

  /**
   * Gets the size of code running in current environment.
   * @return {interger}
   */
  async getCodeSize () {
    const code = await this.exoInterface.code
    return code.length
  }

  /**
   * Copys the code running in current environment to memory.
   * @param {integer} offset the memory offset
   * @param {integer} codeOffset the code offset
   * @param {integer} length the length of code to copy
   */
  async codeCopy (resultOffset, codeOffset, length) {
    this.takeGas(3 + Math.ceil(length / 32) * 3)

    let code = await this.exoInterface.code
    if (code.length) {
      code = code.slice(codeOffset, codeOffset + length)
      this.memoryWrite(resultOffset, length, code)
    }
  }

  /**
   * Get size of an account’s code.
   * @param {integer} addressOffset the offset in memory to load the address from
   * @return {integer}
   */
  getExternalCodeSize (addressOffset, cbOffset) {
    const address = ['accounts', ...this.getMemory(addressOffset, ADDRESS_SIZE_BYTES)]
    const opPromise = this.exoInterface.sendMessage(common.ROOT, common.getterMessage('code', address))
      .then(vertex => vertex.value.length)
      .catch(() => 0)

    // wait for all the prevouse async ops to finish before running the callback
    this.vm.pushOpsQueue(opPromise, cbOffset, length => length)
  }

  /**
   * Copys the code of an account to memory.
   * @param {integer} addressOffset the memory offset of the address
   * @param {integer} resultOffset the memory offset
   * @param {integer} codeOffset the code offset
   * @param {integer} length the length of code to copy
   */
  async externalCodeCopy (addressOffset, resultOffset, codeOffset, length) {
    this.takeGas(20 + Math.ceil(length / 32) * 3)

    const address = ['accounts', ...this.getMemory(addressOffset, ADDRESS_SIZE_BYTES)]
    let opPromise

    if (length) {
      opPromise = this.exoInterface.sendMessage(common.ROOT, common.getterMessage('code', address))
        .get(address)
        .then(vertex => vertex.value)
        .catch(() => [])
    } else {
      opPromise = Promise.resolve([])
    }

    // wait for all the prevouse async ops to finish before running the callback
    let code = await opPromise()
    if (code.length) {
      code = code.slice(codeOffset, codeOffset + length)
      this.memoryWrite(resultOffset, length, code)
    }
  }

  /**
   * Gets price of gas in current environment.
   * @return {integer}
   */
  getTxGasPrice () {
    return this.message.gasPrice
  }

  /**
   * Gets the hash of one of the 256 most recent complete blocks.
   * @param {integer} number which block to load
   * @param {integer} offset the offset to load the hash into
   */
  async getBlockHash (number, offset) {
    const diff = this.message.block.number - number
    let opPromise

    if (diff > 256 || diff <= 0) {
      opPromise = Promise.resolve(new U256(0))
    } else {
      opPromise = this.state.get(['blockchain', number]).then(vertex => vertex.hash())
    }

    // wait for all the prevouse async ops to finish before running the callback
    const hash = await opPromise()
    this.memoryWrite(offset, U256_SIZE_BYTES, hash.toBuffer())
  }

  /**
   * Gets the block’s beneficiary address and loads into memory.
   * @param offset
   */
  getBlockCoinbase (offset) {
    this.memoryWrite(offset, ADDRESS_SIZE_BYTES, this.message.block.header.coinbase)
  }

  /**
   * Get the block’s timestamp.
   * @return {integer}
   */
  getBlockTimestamp () {
    return this.message.block.timestamp
  }

  /**
   * Get the block’s number.
   * @return {integer}
   */
  getBlockNumber () {
    return this.message.block.number
  }

  /**
   * Get the block’s difficulty.
   * @return {integer}
   */
  getBlockDifficulty (offset) {
    this.memoryWrite(offset, U256_SIZE_BYTES, this.message.block.difficulty.toBuffer())
  }

  /**
   * Get the block’s gas limit.
   * @return {integer}
   */
  getBlockGasLimit () {
    return this.message.gasLimit
  }

  /**
   * Creates a new log in the current environment
   * @param {integer} dataOffset the offset in memory to load the memory
   * @param {integer} length the data length
   * @param {integer} number of topics
   */
  log (dataOffset, length, numberOfTopics, topic1, topic2, topic3, topic4) {
    if (numberOfTopics < 0 || numberOfTopics > 4) {
      throw new Error('Invalid numberOfTopics')
    }

    this.takeGas(375 + length * 8 + numberOfTopics * 375)

    const data = length ? this.getMemory(dataOffset, length).slice(0) : new Uint8Array([])
    const topics = []

    if (numberOfTopics > 0) {
      topics.push(U256.fromBuffer(this.getMemory(topic1, U256_SIZE_BYTES)))
    }

    if (numberOfTopics > 1) {
      topics.push(U256.fromBuffer(this.getMemory(topic2, U256_SIZE_BYTES)))
    }

    if (numberOfTopics > 2) {
      topics.push(U256.fromBuffer(this.getMemory(topic3, U256_SIZE_BYTES)))
    }

    if (numberOfTopics > 3) {
      topics.push(U256.fromBuffer(this.getMemory(topic4, U256_SIZE_BYTES)))
    }

    this.exoInterface.sendMessage([this.exoInterface.root, 'logs'], new Message({
      data: data,
      topics: topics
    }))
  }

  /**
   * Creates a new contract with a given value.
   * @param {integer} valueOffset the offset in memory to the value from
   * @param {integer} dataOffset the offset to load the code for the new contract from
   * @param {integer} length the data length
   * @param (integer} resultOffset the offset to write the new contract address to
   * @return {integer} Return 1 or 0 depending on if the VM trapped on the message or not
   */
  async create (valueOffset, dataOffset, length, resultOffset) {
    const value = U256.fromBuffer(this.getMemory(valueOffset, U128_SIZE_BYTES))

    let opPromise

    if (value.gt(this.exoInterface.environment.value)) {
      opPromise = Promise.resolve(Buffer.from(20).fill(0))
    } else {
      // todo actully run the code
      opPromise = Promise.resolve(ethUtil.generateAddress(this.exoInterface.environment.address, this.exoInterface.environment.nonce))
    }

    // wait for all the prevouse async ops to finish before running the callback
    const address = await opPromise()
    this.memoryWrite(resultOffset, ADDRESS_SIZE_BYTES, address)
  }

  /**
   * Sends a message with arbiatary data to a given address path
   * @param {integer} addressOffset the offset to load the address path from
   * @param {integer} valueOffset the offset to load the value from
   * @param {integer} dataOffset the offset to load data from
   * @param {integer} dataLength the length of data
   * @param {integer} resultOffset the offset to store the result data at
   * @param {integer} resultLength
   * @param {integer} gas
   * @return {integer} Returns 1 or 0 depending on if the VM trapped on the message or not
   */
  async _call (gasHigh, gasLow, addressOffset, valueOffset, dataOffset, dataLength, resultOffset, resultLength) {
    this.takeGas(40)
    const gas = from64bit(gasHigh, gasLow)
    // Load the params from mem
    const address = [common.PARENT, common.PARENT, ...this.getMemory(addressOffset, ADDRESS_SIZE_BYTES)]
    const value = new U256(this.getMemory(valueOffset, U128_SIZE_BYTES))

    // Special case for non-zero value; why does this exist?
    if (!value.isZero()) {
      this.takeGas(9000 - 2300 + gas)
      this.takeGas(-gas)
    }

    const message = new Message({
      to: address,
      value: value
    })

    const messagePromise = this.exoInterface.send(message).then(result => {
      if (result.exception) {
        this.takeGas(25000)
      }
    })

    // wait for all the prevouse async ops to finish before running the callback
    await messagePromise()
    return 1
  }

  /**
   * Message-call into this account with an alternative account’s code.
   * @param {integer} addressOffset the offset to load the address path from
   * @param {integer} valueOffset the offset to load the value from
   * @param {integer} dataOffset the offset to load data from
   * @param {integer} dataLength the length of data
   * @param {integer} resultOffset the offset to store the result data at
   * @param {integer} resultLength
   * @param {integer} gas
   * @return {integer} Returns 1 or 0 depending on if the VM trapped on the message or not
   */
  async callCode (gas, addressOffset, valueOffset, dataOffset, dataLength, resultOffset, resultLength) {
    // Load the params from mem
    const path = ['accounts', ...this.getMemory(addressOffset, ADDRESS_SIZE_BYTES), 'code']
    const value = U256.fromBuffer(this.getMemory(valueOffset, U128_SIZE_BYTES))

    // Special case for non-zero value; why does this exist?
    if (!value.isZero()) {
      this.takeGas(6700)
    }

    // TODO: should be message?
    const opPromise = this.state.root.get(path)
      .catch(() => {
        // TODO: handle errors
        // the value was not found
        return null
      })
    await opPromise()
    return 1
  }

  /**
   * Message-call into this account with an alternative account’s code, but
   * persisting the current values for sender and value.
   * @param {integer} gas
   * @param {integer} addressOffset the offset to load the address path from
   * @param {integer} valueOffset the offset to load the value from
   * @param {integer} dataOffset the offset to load data from
   * @param {integer} dataLength the length of data
   * @param {integer} resultOffset the offset to store the result data at
   * @param {integer} resultLength
   * @return {integer} Returns 1 or 0 depending on if the VM trapped on the message or not
   */
  callDelegate (gas, addressOffset, dataOffset, dataLength, resultOffset, resultLength) {
    // FIXME: count properly
    this.takeGas(40)

    const data = this.getMemory(dataOffset, dataLength).slice(0)
    const address = [...this.getMemory(addressOffset, ADDRESS_SIZE_BYTES)]
    const [errorCode, result] = this.environment.callDelegate(gas, address, data)
    this.memoryWrite(resultOffset, resultLength, result)
    return errorCode
  }

  /**
   * store a value at a given path in long term storage which are both loaded
   * from Memory
   * @param {interger} pathOffest the memory offset to load the the path from
   * @param {interger} valueOffset the memory offset to load the value from
   */
  async storageStore (pathOffset, valueOffset) {
    this.takeGas(5000)
    const key = Buffer.from(this.getMemory(pathOffset, U256_SIZE_BYTES)).toString('hex')
    // copy the value
    const value = this.getMemory(valueOffset, U256_SIZE_BYTES).slice(0)
    const valIsZero = value.every((i) => i === 0)
    const opPromise = this.exoInterface.state.get(key)
      .then(vertex => vertex.value)
      .catch(() => null)
      .then()

    const oldValue = await opPromise()
    if (valIsZero && oldValue) {
      // delete a value
      this.results.gasRefund += 15000
      this.exoInterface.state.del(key)
    } else {
      if (!valIsZero && !oldValue) {
        // creating a new value
        this.takeGas(15000)
      }
      // update
      this.exoInterface.state.set(key, new Vertex({
        value: value
      }))
    }
  }

  /**
   * reterives a value at a given path in long term storage
   * @param {interger} pathOffest the memory offset to load the the path from
   * @param {interger} resultOffset the memory offset to load the value from
   */
  async storageLoad (pathOffset, resultOffset) {
    this.takeGas(50)

    // convert the path to an array
    const key = Buffer.from(this.getMemory(pathOffset, U256_SIZE_BYTES)).toString('hex')
    // get the value from the state
    const opPromise = this.exoInterface.state.get([key])
      .then(vertex => vertex.value)
      .catch(() => new Uint8Array(32))

    const value = await opPromise()
    this.memoryWrite(resultOffset, U256_SIZE_BYTES, value)
  }

  /**
   * Halt execution returning output data.
   * @param {integer} offset the offset of the output data.
   * @param {integer} length the length of the output data.
   */
  return (offset, length) {
    if (length) {
      this.results.returnValue = this.getMemory(offset, length).slice(0)
    }
  }

  /**
   * Halt execution and register account for later deletion giving the remaining
   * balance to an address path
   * @param {integer} offset the offset to load the address from
   */
  selfDestruct (addressOffset) {
    this.results.selfDestruct = true
    this.results.selfDestructAddress = this.getMemory(addressOffset, ADDRESS_SIZE_BYTES)
    this.results.gasRefund += 24000
  }

  getMemory (offset, length) {
    return new Uint8Array(this.vm.memory(), offset, length)
  }

  /*
   * Takes gas from the tank. Only needs to check if there's gas left to be taken,
   * because every caller of this method is trusted.
   */
  takeGas (amount) {
    if (this.message.gas < amount) {
      throw new Error('Ran out of gas')
    }
    this.message.gas -= amount
  }

  memoryWrite (offset, length, buffer) {
    for (let i = offset; i < length; i++) {
      this.memory[i] = buffer[i]
    }
  }

  setMemory (memory) {
    this.memory = memory
  }
}

// converts a 64 bit number to a JS number
function from64bit (high, low) {
  if (high < 0) {
    // convert from a 32-bit two's compliment
    high = 0x100000000 - high
  }
  if (low < 0) {
    // convert from a 32-bit two's compliment
    low = 0x100000000 - low
  }
  // JS only bitshift 32bits, so instead of high << 32 we have high * 2 ^ 32
  return (high * 4294967296) + low
}
