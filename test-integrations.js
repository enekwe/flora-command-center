/**
 * Integration Test Script for Slack and Gmail OAuth
 *
 * Tests:
 * - Encryption/Decryption
 * - State parameter encryption
 * - OAuth URL generation
 * - Token encryption/decryption
 */

const encryption = require('./src/utils/encryption');

console.log('=== Flora Command Center Integration Tests ===\n');

// Test 1: Encryption/Decryption
console.log('Test 1: Encryption/Decryption');
try {
  const plainText = 'test-access-token-12345';
  const encrypted = encryption.encrypt(plainText);
  const decrypted = encryption.decrypt(encrypted);

  console.log('  Plain text:', plainText);
  console.log('  Encrypted:', encrypted.substring(0, 50) + '...');
  console.log('  Decrypted:', decrypted);
  console.log('  Match:', plainText === decrypted ? '✓ PASS' : '✗ FAIL');
  console.log('');
} catch (error) {
  console.log('  ✗ FAIL:', error.message);
  console.log('');
}

// Test 2: State Parameter Encryption
console.log('Test 2: State Parameter Encryption');
try {
  const stateData = {
    userId: '507f1f77bcf86cd799439011',
    organizationId: '507f191e810c19729de860ea',
    timestamp: Date.now(),
    nonce: 'abc123'
  };

  const encryptedState = encryption.encryptState(stateData);
  const decryptedState = encryption.decryptState(encryptedState);

  console.log('  Original state:', JSON.stringify(stateData, null, 2));
  console.log('  Encrypted state:', encryptedState.substring(0, 50) + '...');
  console.log('  Decrypted state:', JSON.stringify(decryptedState, null, 2));
  console.log('  Match:',
    stateData.userId === decryptedState.userId &&
    stateData.organizationId === decryptedState.organizationId ? '✓ PASS' : '✗ FAIL'
  );
  console.log('');
} catch (error) {
  console.log('  ✗ FAIL:', error.message);
  console.log('');
}

// Test 3: Slack Auth Service
console.log('Test 3: Slack Auth Service');
try {
  // Set mock credentials for testing
  process.env.SLACK_CLIENT_ID = 'test-client-id';
  process.env.SLACK_CLIENT_SECRET = 'test-client-secret';
  process.env.SLACK_REDIRECT_URI = 'http://localhost:4000/api/integrations/slack/callback';

  const slackAuthService = require('./src/integrations/slack/services/slackAuthService');

  const authUrl = slackAuthService.getAuthorizationUrl(
    '507f1f77bcf86cd799439011',
    '507f191e810c19729de860ea'
  );

  console.log('  Auth URL generated:', authUrl.substring(0, 100) + '...');
  console.log('  Contains client_id:', authUrl.includes('client_id=test-client-id') ? '✓ PASS' : '✗ FAIL');
  console.log('  Contains redirect_uri:', authUrl.includes('redirect_uri=') ? '✓ PASS' : '✗ FAIL');
  console.log('  Contains state:', authUrl.includes('state=') ? '✓ PASS' : '✗ FAIL');
  console.log('');
} catch (error) {
  console.log('  ✗ FAIL:', error.message);
  console.log('');
}

// Test 4: Gmail Auth Service
console.log('Test 4: Gmail Auth Service');
try {
  // Set mock credentials for testing
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:4000/api/integrations/gmail/callback';

  const gmailAuthService = require('./src/integrations/gmail/services/gmailAuthService');

  const authUrl = gmailAuthService.getAuthorizationUrl(
    '507f1f77bcf86cd799439011',
    '507f191e810c19729de860ea'
  );

  console.log('  Auth URL generated:', authUrl.substring(0, 100) + '...');
  console.log('  Contains client_id:', authUrl.includes('client_id=test-google-client-id') ? '✓ PASS' : '✗ FAIL');
  console.log('  Contains redirect_uri:', authUrl.includes('redirect_uri=') ? '✓ PASS' : '✗ FAIL');
  console.log('  Contains state:', authUrl.includes('state=') ? '✓ PASS' : '✗ FAIL');
  console.log('  Contains access_type=offline:', authUrl.includes('access_type=offline') ? '✓ PASS' : '✗ FAIL');
  console.log('');
} catch (error) {
  console.log('  ✗ FAIL:', error.message);
  console.log('');
}

// Test 5: Token Encryption Methods
console.log('Test 5: Token Encryption Methods');
try {
  const slackAuthService = require('./src/integrations/slack/services/slackAuthService');
  const gmailAuthService = require('./src/integrations/gmail/services/gmailAuthService');

  const testToken = 'xoxb-test-token-12345';

  // Test Slack encryption
  const slackEncrypted = slackAuthService.encryptToken(testToken);
  const slackDecrypted = slackAuthService.decryptToken(slackEncrypted);

  console.log('  Slack token encryption:');
  console.log('    Original:', testToken);
  console.log('    Encrypted:', slackEncrypted.substring(0, 50) + '...');
  console.log('    Decrypted:', slackDecrypted);
  console.log('    Match:', testToken === slackDecrypted ? '✓ PASS' : '✗ FAIL');

  // Test Gmail encryption
  const gmailEncrypted = gmailAuthService.encryptToken(testToken);
  const gmailDecrypted = gmailAuthService.decryptToken(gmailEncrypted);

  console.log('  Gmail token encryption:');
  console.log('    Original:', testToken);
  console.log('    Encrypted:', gmailEncrypted.substring(0, 50) + '...');
  console.log('    Decrypted:', gmailDecrypted);
  console.log('    Match:', testToken === gmailDecrypted ? '✓ PASS' : '✗ FAIL');
  console.log('');
} catch (error) {
  console.log('  ✗ FAIL:', error.message);
  console.log('');
}

// Test 6: Model Structure
console.log('Test 6: Model Structure Validation');
try {
  const SlackConnection = require('./src/integrations/slack/models/SlackConnection');
  const GmailConnection = require('./src/integrations/gmail/models/GmailConnection');

  console.log('  Slack Connection Schema:');
  console.log('    Has userId field:', SlackConnection.schema.paths.userId ? '✓ PASS' : '✗ FAIL');
  console.log('    Has organizationId field:', SlackConnection.schema.paths.organizationId ? '✓ PASS' : '✗ FAIL');
  console.log('    Has accessToken field:', SlackConnection.schema.paths.accessToken ? '✓ PASS' : '✗ FAIL');
  console.log('    accessToken select: false:',
    SlackConnection.schema.paths.accessToken.options.select === false ? '✓ PASS' : '✗ FAIL'
  );

  console.log('  Gmail Connection Schema:');
  console.log('    Has userId field:', GmailConnection.schema.paths.userId ? '✓ PASS' : '✗ FAIL');
  console.log('    Has organizationId field:', GmailConnection.schema.paths.organizationId ? '✓ PASS' : '✗ FAIL');
  console.log('    Has accessToken field:', GmailConnection.schema.paths.accessToken ? '✓ PASS' : '✗ FAIL');
  console.log('    accessToken select: false:',
    GmailConnection.schema.paths.accessToken.options.select === false ? '✓ PASS' : '✗ FAIL'
  );
  console.log('');
} catch (error) {
  console.log('  ✗ FAIL:', error.message);
  console.log('');
}

console.log('=== All Tests Complete ===');
console.log('\nNote: These are unit tests. Full integration testing requires:');
console.log('  - MongoDB connection');
console.log('  - Valid Slack OAuth credentials');
console.log('  - Valid Google OAuth credentials');
console.log('  - Running server with actual OAuth flow');
