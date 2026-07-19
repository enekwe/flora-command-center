// Mock dependencies first
jest.mock('../gmailAuthService');
jest.mock('../gmailSyncService');
jest.mock('../../models/GmailConnection');
jest.mock('../../../../utils/logger');

const gmailPollingService = require('../gmailPollingService');

describe('Gmail Polling Service - Email Routing', () => {
  describe('extractOriginalRecipient()', () => {
    it('should extract from X-Original-To header when present', () => {
      const emailData = {
        headers: [
          { name: 'X-Original-To', value: 'deals@flora.passbook.vc' },
          { name: 'To', value: 'crm@flora.passbook.vc' }
        ]
      };

      const result = gmailPollingService.extractOriginalRecipient(emailData);
      expect(result).toBe('deals@flora.passbook.vc');
    });

    it('should fall back to To header when X-Original-To missing', () => {
      const emailData = {
        headers: [
          { name: 'To', value: 'deals@flora.passbook.vc' }
        ]
      };

      const result = gmailPollingService.extractOriginalRecipient(emailData);
      expect(result).toBe('deals@flora.passbook.vc');
    });

    it('should return empty string if both headers missing', () => {
      const emailData = {
        headers: [
          { name: 'From', value: 'sender@example.com' }
        ]
      };

      const result = gmailPollingService.extractOriginalRecipient(emailData);
      expect(result).toBe('');
    });

    it('should lowercase the result', () => {
      const emailData = {
        headers: [
          { name: 'X-Original-To', value: 'DEALS@FLORA.PASSBOOK.VC' }
        ]
      };

      const result = gmailPollingService.extractOriginalRecipient(emailData);
      expect(result).toBe('deals@flora.passbook.vc');
    });

    it('should handle case-insensitive header names', () => {
      const emailData = {
        headers: [
          { name: 'x-original-to', value: 'deals@flora.passbook.vc' }
        ]
      };

      const result = gmailPollingService.extractOriginalRecipient(emailData);
      expect(result).toBe('deals@flora.passbook.vc');
    });

    it('should handle empty headers array', () => {
      const emailData = {
        headers: []
      };

      const result = gmailPollingService.extractOriginalRecipient(emailData);
      expect(result).toBe('');
    });
  });

  describe('determineContext()', () => {
    it('should return deal context for deals@ address', () => {
      const emailData = {
        headers: [
          { name: 'X-Original-To', value: 'deals@flora.passbook.vc' },
          { name: 'To', value: 'crm@flora.passbook.vc' },
          { name: 'Subject', value: 'Test Email' }
        ],
        body: 'Test body content',
        snippet: 'Test snippet'
      };

      const result = gmailPollingService.determineContext(emailData);
      expect(result.type).toBe('deal');
      expect(result.specificId).toBeNull();
      expect(result.confidence).toBe('high');
      expect(result.routingMethod).toBe('header');
    });

    it('should return fundraising context for fundraising@ address', () => {
      const emailData = {
        headers: [
          { name: 'X-Original-To', value: 'fundraising@flora.passbook.vc' }
        ],
        body: '',
        snippet: ''
      };

      const result = gmailPollingService.determineContext(emailData);
      expect(result.type).toBe('fundraising');
      expect(result.confidence).toBe('high');
      expect(result.routingMethod).toBe('header');
    });

    it('should return introduction context for intros@ address', () => {
      const emailData = {
        headers: [
          { name: 'X-Original-To', value: 'intros@flora.passbook.vc' }
        ],
        body: '',
        snippet: ''
      };

      const result = gmailPollingService.determineContext(emailData);
      expect(result.type).toBe('introduction');
      expect(result.confidence).toBe('high');
    });

    it('should return sms context for texts@ address', () => {
      const emailData = {
        headers: [
          { name: 'X-Original-To', value: 'texts@flora.passbook.vc' }
        ],
        body: '',
        snippet: ''
      };

      const result = gmailPollingService.determineContext(emailData);
      expect(result.type).toBe('sms');
      expect(result.confidence).toBe('high');
    });

    it('should extract deal ID from deal-{id}@ address', () => {
      const dealId = '507f1f77bcf86cd799439011';
      const emailData = {
        headers: [
          { name: 'X-Original-To', value: `deal-${dealId}@flora.passbook.vc` }
        ],
        body: '',
        snippet: ''
      };

      const result = gmailPollingService.determineContext(emailData);
      expect(result.type).toBe('deal');
      expect(result.specificId).toBe(dealId);
      expect(result.confidence).toBe('high');
      expect(result.routingMethod).toBe('dealId');
    });

    it('should handle uppercase deal ID', () => {
      const dealId = '507F1F77BCF86CD799439011';
      const emailData = {
        headers: [
          { name: 'X-Original-To', value: `deal-${dealId}@flora.passbook.vc` }
        ],
        body: '',
        snippet: ''
      };

      const result = gmailPollingService.determineContext(emailData);
      expect(result.specificId).toBe(dealId.toLowerCase());
    });

    it('should use keyword matching as fallback for deal', () => {
      const emailData = {
        headers: [
          { name: 'To', value: 'crm@flora.passbook.vc' },
          { name: 'Subject', value: 'Discussion about our deal' }
        ],
        body: 'Let\'s talk about the deal',
        snippet: 'deal discussion'
      };

      const result = gmailPollingService.determineContext(emailData);
      expect(result.type).toBe('deal');
      expect(result.confidence).toBe('low');
      expect(result.routingMethod).toBe('keyword');
    });

    it('should use keyword matching as fallback for fundraising', () => {
      const emailData = {
        headers: [
          { name: 'To', value: 'crm@flora.passbook.vc' },
          { name: 'Subject', value: 'Fundraising strategy' }
        ],
        body: 'Our fundraising plans',
        snippet: ''
      };

      const result = gmailPollingService.determineContext(emailData);
      expect(result.type).toBe('fundraising');
      expect(result.confidence).toBe('low');
      expect(result.routingMethod).toBe('keyword');
    });

    it('should use keyword matching as fallback for intro', () => {
      const emailData = {
        headers: [
          { name: 'To', value: 'crm@flora.passbook.vc' },
          { name: 'Subject', value: 'Introduction request' }
        ],
        body: 'Can you intro me to...',
        snippet: ''
      };

      const result = gmailPollingService.determineContext(emailData);
      expect(result.type).toBe('introduction');
      expect(result.confidence).toBe('low');
      expect(result.routingMethod).toBe('keyword');
    });

    it('should return general for unrecognized context', () => {
      const emailData = {
        headers: [
          { name: 'To', value: 'crm@flora.passbook.vc' },
          { name: 'Subject', value: 'Random email' }
        ],
        body: 'Just a random message',
        snippet: ''
      };

      const result = gmailPollingService.determineContext(emailData);
      expect(result.type).toBe('general');
      expect(result.confidence).toBe('unknown');
      expect(result.routingMethod).toBe('default');
    });

    it('should prioritize header matching over keyword matching', () => {
      const emailData = {
        headers: [
          { name: 'X-Original-To', value: 'deals@flora.passbook.vc' },
          { name: 'Subject', value: 'Fundraising discussion' }
        ],
        body: 'Let\'s discuss fundraising',
        snippet: ''
      };

      const result = gmailPollingService.determineContext(emailData);
      expect(result.type).toBe('deal');
      expect(result.confidence).toBe('high');
      expect(result.routingMethod).toBe('header');
    });

    it('should prioritize deal ID extraction over generic deal header', () => {
      const dealId = '507f1f77bcf86cd799439011';
      const emailData = {
        headers: [
          { name: 'X-Original-To', value: `deal-${dealId}@flora.passbook.vc` }
        ],
        body: '',
        snippet: ''
      };

      const result = gmailPollingService.determineContext(emailData);
      expect(result.specificId).toBe(dealId);
      expect(result.routingMethod).toBe('dealId');
    });

    it('should handle invalid deal ID format', () => {
      const emailData = {
        headers: [
          { name: 'X-Original-To', value: 'deal-notavalidid@flora.passbook.vc' }
        ],
        body: '',
        snippet: ''
      };

      const result = gmailPollingService.determineContext(emailData);
      // Should not extract invalid ID, fall back to keyword or general
      expect(result.specificId).toBeNull();
    });

    it('should check fundraising keyword before deal keyword', () => {
      const emailData = {
        headers: [
          { name: 'To', value: 'crm@flora.passbook.vc' },
          { name: 'Subject', value: 'Fundraising for the deal' }
        ],
        body: 'Both fundraising and deal mentioned',
        snippet: ''
      };

      const result = gmailPollingService.determineContext(emailData);
      // Fundraising should be checked first in keyword matching
      expect(result.type).toBe('fundraising');
      expect(result.confidence).toBe('low');
    });
  });

  describe('extractEmailData() with routing metadata', () => {
    it('should include X-Original-To header in extracted data', () => {
      const message = {
        id: 'msg123',
        threadId: 'thread123',
        snippet: 'Test snippet',
        labelIds: ['INBOX'],
        internalDate: '1234567890',
        payload: {
          headers: [
            { name: 'From', value: 'sender@example.com' },
            { name: 'To', value: 'crm@flora.passbook.vc' },
            { name: 'X-Original-To', value: 'deals@flora.passbook.vc' },
            { name: 'Subject', value: 'Test Subject' },
            { name: 'Date', value: '2026-07-16' }
          ],
          body: {
            data: Buffer.from('Test body').toString('base64')
          }
        }
      };

      const result = gmailPollingService.extractEmailData(message);

      expect(result.messageId).toBe('msg123');
      expect(result.from).toBe('sender@example.com');
      expect(result.to).toBe('crm@flora.passbook.vc');
      expect(result.subject).toBe('Test Subject');

      // Should include headers for routing
      expect(result.headers).toEqual(message.payload.headers);
    });
  });
});
