/**
 * TDD test suite for payment instruction parser
 * Tests all validation rules, priorities, and edge cases
 */
/* eslint-disable no-unused-expressions */
const { expect } = require('chai');
const createMockServer = require('@app-core/mock-server');

// Create mock server with payment endpoint
const mockServer = createMockServer(['endpoints/payment-instructions/']);

describe('Payment Instruction Parser TDD', () => {
  /**
   * Test successful DEBIT transactions
   */
  describe('DEBIT Format Success Cases', () => {
    it('should process basic DEBIT instruction', async () => {
      const request = {
        accounts: [
          { id: 'a', balance: 230, currency: 'USD' },
          { id: 'b', balance: 300, currency: 'USD' },
        ],
        instruction: 'DEBIT 30 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(200);
      expect(res.data.data).to.deep.include({
        type: 'DEBIT',
        amount: 30,
        currency: 'USD',
        debit_account: 'a',
        credit_account: 'b',
        execute_by: null,
        status: 'successful',
        status_code: 'AP00',
      });
      expect(res.data.data.accounts[0].balance).to.equal(200);
      expect(res.data.data.accounts[1].balance).to.equal(330);
    });

    it('should handle case-insensitive keywords', async () => {
      const request = {
        accounts: [
          { id: 'x', balance: 500, currency: 'GBP' },
          { id: 'y', balance: 200, currency: 'GBP' },
        ],
        instruction: 'debit 100 gbp from account x for credit to account y',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(200);
      expect(res.data.data.currency).to.equal('GBP'); // Uppercase
      expect(res.data.data.type).to.equal('DEBIT');
    });

    it('should execute past dates immediately', async () => {
      const request = {
        accounts: [
          { id: 'acc1', balance: 1000, currency: 'NGN' },
          { id: 'acc2', balance: 500, currency: 'NGN' },
        ],
        instruction: 'DEBIT 200 NGN FROM ACCOUNT acc1 FOR CREDIT TO ACCOUNT acc2 ON 2024-01-15',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(200);
      expect(res.data.data.status).to.equal('successful');
      expect(res.data.data.status_code).to.equal('AP00');
      expect(res.data.data.execute_by).to.equal('2024-01-15');
    });
  });

  /**
   * Test successful CREDIT transactions
   */
  describe('CREDIT Format Success Cases', () => {
    it('should process CREDIT instruction', async () => {
      const request = {
        accounts: [
          { id: 'src', balance: 1000, currency: 'GHS' },
          { id: 'dst', balance: 500, currency: 'GHS' },
        ],
        instruction: 'CREDIT 300 GHS TO ACCOUNT dst FOR DEBIT FROM ACCOUNT src',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(200);
      expect(res.data.data.type).to.equal('CREDIT');
      expect(res.data.data.debit_account).to.equal('src');
      expect(res.data.data.credit_account).to.equal('dst');
      expect(res.data.data.accounts[0].balance).to.equal(700);
      expect(res.data.data.accounts[1].balance).to.equal(800);
    });

    it('should handle future dates as pending', async () => {
      const request = {
        accounts: [
          { id: 'acc-001', balance: 1000, currency: 'NGN' },
          { id: 'acc-002', balance: 500, currency: 'NGN' },
        ],
        instruction:
          'CREDIT 300 NGN TO ACCOUNT acc-002 FOR DEBIT FROM ACCOUNT acc-001 ON 2026-12-31',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(200);
      expect(res.data.data.status).to.equal('pending');
      expect(res.data.data.status_code).to.equal('AP02');
      expect(res.data.data.accounts[0].balance).to.equal(1000); // Unchanged
      expect(res.data.data.accounts[1].balance).to.equal(500); // Unchanged
    });
  });

  /**
   * Test prioritized error handling
   */
  describe('Error Priority Validation', () => {
    it('should return SY01 or SY03 for malformed instruction', async () => {
      const request = {
        accounts: [
          { id: 'a', balance: 500, currency: 'USD' },
          { id: 'b', balance: 200, currency: 'USD' },
        ],
        instruction: 'SEND 100 USD TO ACCOUNT b',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(400);
      // Either SY01 or SY03 is acceptable per spec
      expect(['SY01', 'SY03']).to.include(res.data.data.status_code);
      expect(res.data.data.type).to.be.null;
      expect(res.data.data.amount).to.be.null;
      expect(res.data.data.accounts).to.be.empty;
    });

    it('should return AM01 for invalid amount', async () => {
      const request = {
        accounts: [
          { id: 'a', balance: 500, currency: 'USD' },
          { id: 'b', balance: 200, currency: 'USD' },
        ],
        instruction: 'DEBIT -100 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(400);
      expect(res.data.data.status_code).to.equal('AM01');
    });

    it('should return AM01 for decimal amount', async () => {
      const request = {
        accounts: [
          { id: 'a', balance: 500, currency: 'USD' },
          { id: 'b', balance: 200, currency: 'USD' },
        ],
        instruction: 'DEBIT 100.50 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(400);
      expect(res.data.data.status_code).to.equal('AM01');
    });

    it('should return AC04 for invalid account ID', async () => {
      const request = {
        accounts: [
          { id: 'a!@#', balance: 500, currency: 'USD' },
          { id: 'b', balance: 200, currency: 'USD' },
        ],
        instruction: 'DEBIT 100 USD FROM ACCOUNT a!@# FOR CREDIT TO ACCOUNT b',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(400);
      expect(res.data.data.status_code).to.equal('AC04');
    });

    it('should return DT01 for invalid date', async () => {
      const request = {
        accounts: [
          { id: 'a', balance: 500, currency: 'USD' },
          { id: 'b', balance: 200, currency: 'USD' },
        ],
        instruction: 'DEBIT 100 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b ON 2026/12/31',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(400);
      expect(res.data.data.status_code).to.equal('DT01');
    });

    it('should return AC03 for account not found', async () => {
      const request = {
        accounts: [{ id: 'a', balance: 500, currency: 'USD' }],
        instruction: 'DEBIT 100 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT xyz',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(400);
      expect(res.data.data.status_code).to.equal('AC03');
    });

    it('should return CU02 for unsupported currency', async () => {
      const request = {
        accounts: [
          { id: 'a', balance: 100, currency: 'EUR' },
          { id: 'b', balance: 500, currency: 'EUR' },
        ],
        instruction: 'DEBIT 50 EUR FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(400);
      expect(res.data.data.status_code).to.equal('CU02');
    });

    it('should return CU01 for currency mismatch', async () => {
      const request = {
        accounts: [
          { id: 'a', balance: 100, currency: 'USD' },
          { id: 'b', balance: 500, currency: 'GBP' },
        ],
        instruction: 'DEBIT 50 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(400);
      expect(res.data.data.status_code).to.equal('CU01');
    });

    it('should return AC02 for same account', async () => {
      const request = {
        accounts: [{ id: 'a', balance: 500, currency: 'USD' }],
        instruction: 'DEBIT 100 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT a',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(400);
      expect(res.data.data.status_code).to.equal('AC02');
    });

    it('should return AC01 for insufficient funds', async () => {
      const request = {
        accounts: [
          { id: 'a', balance: 100, currency: 'USD' },
          { id: 'b', balance: 500, currency: 'USD' },
        ],
        instruction: 'DEBIT 500 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(400);
      expect(res.data.data.status_code).to.equal('AC01');
    });
  });

  /**
   * Test edge cases
   */
  describe('Edge Cases', () => {
    it('should handle extra whitespace', async () => {
      const request = {
        accounts: [
          { id: 'a', balance: 500, currency: 'USD' },
          { id: 'b', balance: 200, currency: 'USD' },
        ],
        instruction: '  DEBIT   100   USD  FROM  ACCOUNT  a  FOR  CREDIT  TO  ACCOUNT  b  ',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(200);
      expect(res.data.data.status).to.equal('successful');
    });

    it('should handle special characters in account IDs', async () => {
      const request = {
        accounts: [
          { id: 'acc-001.test', balance: 500, currency: 'USD' },
          { id: 'user@bank', balance: 200, currency: 'USD' },
        ],
        instruction: 'DEBIT 100 USD FROM ACCOUNT acc-001.test FOR CREDIT TO ACCOUNT user@bank',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(200);
      expect(res.data.data.debit_account).to.equal('acc-001.test');
      expect(res.data.data.credit_account).to.equal('user@bank');
    });

    it('should maintain account order from input', async () => {
      const request = {
        accounts: [
          { id: 'b', balance: 300, currency: 'USD' },
          { id: 'a', balance: 230, currency: 'USD' },
          { id: 'c', balance: 100, currency: 'USD' },
        ],
        instruction: 'DEBIT 30 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
      };

      const res = await mockServer.post('/payment-instructions', {
        body: request,
      });

      expect(res.statusCode).to.equal(200);
      expect(res.data.data.accounts).to.have.lengthOf(2);
      expect(res.data.data.accounts[0].id).to.equal('b'); // First in input
      expect(res.data.data.accounts[1].id).to.equal('a'); // Second in input
    });
  });
});
