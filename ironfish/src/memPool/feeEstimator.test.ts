/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { Assert } from '../assert'
import {
  createNodeTest,
  useAccountFixture,
  useBlockWithTx,
  useBlockWithTxs,
} from '../testUtilities'
import { FeeEstimator, getFeeRate } from './feeEstimator'

describe('FeeEstimator', () => {
  const nodeTest = createNodeTest()

  describe('setUp', () => {
    it('should build recent fee cache with capacity of 1', async () => {
      const node = nodeTest.node

      const { block, transaction } = await useBlockWithTx(node, undefined, undefined, true, {
        fee: 10,
      })

      await node.chain.addBlock(block)

      const feeEstimator = new FeeEstimator({
        wallet: node.wallet,
        recentBlocksNum: 1,
        txSampleSize: 1,
      })
      await feeEstimator.setUp()

      expect(feeEstimator.estimateFeeRate(60)).toBe(getFeeRate(transaction))
    })

    it('should build recent fee cache with more than one transaction', async () => {
      const node = nodeTest.node
      const { account, block, transaction } = await useBlockWithTx(
        node,
        undefined,
        undefined,
        true,
        { fee: 10 },
      )

      await node.chain.addBlock(block)

      const fee = Number(transaction.fee()) - 1
      const { block: block2, transaction: transaction2 } = await useBlockWithTx(
        node,
        account,
        account,
        true,
        { fee },
      )

      await node.chain.addBlock(block2)

      const feeEstimator = new FeeEstimator({
        wallet: node.wallet,
        recentBlocksNum: 1,
        txSampleSize: 1,
      })
      await feeEstimator.setUp()

      expect(feeEstimator.size()).toBe(1)
      expect(feeEstimator.estimateFeeRate(60)).toBe(getFeeRate(transaction2))
    })
  })

  describe('onConnectBlock', () => {
    it('should add all transactions from a block that are in the mempool', async () => {
      const node = nodeTest.node
      const { block, transaction } = await useBlockWithTx(node, undefined, undefined, true, {
        fee: 10,
      })

      await node.chain.addBlock(block)

      const feeEstimator = new FeeEstimator({
        wallet: node.wallet,
        recentBlocksNum: 1,
        txSampleSize: 1,
      })

      expect(feeEstimator.size()).toBe(0)

      node.memPool.acceptTransaction(transaction)

      feeEstimator.onConnectBlock(block, node.memPool)

      expect(feeEstimator.size()).toBe(1)
      expect(feeEstimator.estimateFeeRate(60)).toBe(getFeeRate(transaction))
    })

    it('should exclude transactions from a block that are not in the mempool', async () => {
      const node = nodeTest.node
      const { block, transaction } = await useBlockWithTx(node, undefined, undefined, true, {
        fee: 10,
      })

      await node.chain.addBlock(block)

      const feeEstimator = new FeeEstimator({
        wallet: node.wallet,
        recentBlocksNum: 1,
        txSampleSize: 1,
      })

      expect(feeEstimator.size()).toBe(0)

      Assert.isFalse(node.memPool.exists(transaction.hash()))

      feeEstimator.onConnectBlock(block, node.memPool)

      expect(feeEstimator.size()).toBe(0)
    })

    it('should remove old transactions from the cache when its maximum size is reached', async () => {
      const node = nodeTest.node

      const feeEstimator = new FeeEstimator({
        wallet: node.wallet,
        recentBlocksNum: 1,
        txSampleSize: 1,
      })

      const { account, block, transaction } = await useBlockWithTx(
        node,
        undefined,
        undefined,
        true,
        { fee: 10 },
      )

      node.memPool.acceptTransaction(transaction)

      feeEstimator.onConnectBlock(block, node.memPool)

      expect(feeEstimator.size()).toBe(1)

      const fee = Number(transaction.fee()) - 1
      const { block: block2, transaction: transaction2 } = await useBlockWithTx(
        node,
        account,
        account,
        true,
        {
          fee,
        },
      )

      node.memPool.acceptTransaction(transaction2)

      feeEstimator.onConnectBlock(block2, node.memPool)

      expect(feeEstimator.size()).toBe(1)
      expect(feeEstimator.estimateFeeRate(60)).toBe(getFeeRate(transaction2))
    })

    it('should keep old transactions in the cache if its maximum size has not been reached', async () => {
      const node = nodeTest.node

      const feeEstimator = new FeeEstimator({
        wallet: node.wallet,
        recentBlocksNum: 2,
        txSampleSize: 1,
      })

      const { account, block, transaction } = await useBlockWithTx(
        node,
        undefined,
        undefined,
        true,
        { fee: 10 },
      )

      node.memPool.acceptTransaction(transaction)

      feeEstimator.onConnectBlock(block, node.memPool)

      expect(feeEstimator.size()).toBe(1)

      const fee = Number(transaction.fee()) - 1
      const { block: block2, transaction: transaction2 } = await useBlockWithTx(
        node,
        account,
        account,
        true,
        {
          fee,
        },
      )

      node.memPool.acceptTransaction(transaction2)

      feeEstimator.onConnectBlock(block2, node.memPool)

      expect(feeEstimator.size()).toBe(2)
    })

    it('should add only add a limited number of transactions from each block', async () => {
      const node = nodeTest.node

      const feeEstimator = new FeeEstimator({
        wallet: node.wallet,
        recentBlocksNum: 2,
        txSampleSize: 2,
      })

      const { account, block, transaction } = await useBlockWithTx(
        node,
        undefined,
        undefined,
        true,
        {
          fee: 10,
        },
      )

      node.memPool.acceptTransaction(transaction)

      feeEstimator.onConnectBlock(block, node.memPool)

      expect(feeEstimator.size()).toBe(1)

      const { block: newBlock, transactions: newTransactions } = await useBlockWithTxs(
        node,
        3,
        account,
      )
      for (const newTransaction of newTransactions) {
        node.memPool.acceptTransaction(newTransaction)
      }

      feeEstimator.onConnectBlock(newBlock, node.memPool)

      expect(feeEstimator.size()).toBe(3)

      // transaction from first block is still in the cache
      expect(feeEstimator['queue'][0].blockHash).toEqualHash(block.header.hash)
    })
  })

  describe('onDisconnectBlock', () => {
    it('should remove all transactions from a block from the end of the queue', async () => {
      const node = nodeTest.node

      const feeEstimator = new FeeEstimator({
        wallet: node.wallet,
        recentBlocksNum: 2,
        txSampleSize: 2,
      })

      const { block, transaction } = await useBlockWithTx(node, undefined, undefined, true)

      node.memPool.acceptTransaction(transaction)

      feeEstimator.onConnectBlock(block, node.memPool)

      expect(feeEstimator.size()).toBe(1)

      feeEstimator.onDisconnectBlock(block)

      expect(feeEstimator.size()).toBe(0)
    })

    it('should not remove transactions from the queue that did not come from the disconnected block', async () => {
      const node = nodeTest.node

      const feeEstimator = new FeeEstimator({
        wallet: node.wallet,
        recentBlocksNum: 2,
        txSampleSize: 1,
      })

      const { account, block, transaction } = await useBlockWithTx(
        node,
        undefined,
        undefined,
        true,
        { fee: 10 },
      )

      node.memPool.acceptTransaction(transaction)

      feeEstimator.onConnectBlock(block, node.memPool)

      expect(feeEstimator.size()).toBe(1)

      const fee = Number(transaction.fee()) - 1
      const { block: block2, transaction: transaction2 } = await useBlockWithTx(
        node,
        account,
        account,
        true,
        {
          fee,
        },
      )

      node.memPool.acceptTransaction(transaction2)

      feeEstimator.onConnectBlock(block2, node.memPool)

      expect(feeEstimator.size()).toBe(2)

      feeEstimator.onDisconnectBlock(block2)

      expect(feeEstimator.size()).toBe(1)
    })
  })

  describe('estimateFee', () => {
    it('should estimate fee for a pending transaction', async () => {
      const node = nodeTest.node
      const { account, block } = await useBlockWithTx(node, undefined, undefined, true, {
        fee: 10,
      })

      const receiver = await useAccountFixture(node.wallet, 'accountA')

      await node.chain.addBlock(block)

      const feeEstimator = new FeeEstimator({
        wallet: node.wallet,
        recentBlocksNum: 1,
        txSampleSize: 1,
      })
      await feeEstimator.setUp()

      const fee = await feeEstimator.estimateFee(20, account, [
        {
          publicAddress: receiver.publicAddress,
          amount: BigInt(5),
          memo: 'test',
        },
      ])

      expect(fee).toBe(BigInt(10))
    })
  })
})
