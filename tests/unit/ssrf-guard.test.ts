import { describe, expect, it } from 'vitest';

import { isForbiddenIp, normalizeHostname, contentTypeAllowed } from '@/lib/server/ssrf-guard';

describe('isForbiddenIp', () => {
  it('blocks loopback, private, link-local, CGNAT, multicast and reserved v4', () => {
    const forbidden = [
      '127.0.0.1',
      '127.8.8.8',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata endpoint
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
    ];
    for (const ip of forbidden) {
      expect(isForbiddenIp(ip), ip).toBe(true);
    }
  });

  it('allows public v4 addresses', () => {
    const allowed = ['8.8.8.8', '1.1.1.1', '142.250.74.142', '172.32.0.1', '9.9.9.9'];
    for (const ip of allowed) {
      expect(isForbiddenIp(ip), ip).toBe(false);
    }
  });

  it('blocks IPv6 loopback, link-local, unique-local, multicast and v4-mapped', () => {
    const forbidden = [
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12:3456::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::ffff:192.168.0.5',
      '2001:db8::1',
    ];
    for (const ip of forbidden) {
      expect(isForbiddenIp(ip), ip).toBe(true);
    }
  });

  it('allows public IPv6', () => {
    expect(isForbiddenIp('2606:4700:4700::1111')).toBe(false);
    expect(isForbiddenIp('2001:4860:4860::8888')).toBe(false);
  });

  it('refuses unparseable inputs', () => {
    expect(isForbiddenIp('not-an-ip')).toBe(true);
    expect(isForbiddenIp('')).toBe(true);
  });
});

describe('normalizeHostname', () => {
  it('decodes pure-decimal hostnames', () => {
    expect(normalizeHostname('2130706433')).toBe('127.0.0.1');
    expect(normalizeHostname('134744072')).toBe('8.8.8.8');
  });

  it('decodes pure hex hostnames', () => {
    expect(normalizeHostname('0x7f000001')).toBe('127.0.0.1');
    expect(normalizeHostname('0x7f.0.0.1')).toBe('127.0.0.1');
  });

  it('decodes octal hostnames', () => {
    expect(normalizeHostname('017700000001')).toBe('127.0.0.1');
    expect(normalizeHostname('0177.0.0.1')).toBe('127.0.0.1');
  });

  it('leaves real hostnames untouched (trailing dot stripped)', () => {
    expect(normalizeHostname('example.com')).toBe('example.com');
    expect(normalizeHostname('EXAMPLE.com.')).toBe('example.com');
  });
});

describe('contentTypeAllowed', () => {
  it('accepts HLS media content types', () => {
    expect(contentTypeAllowed('application/vnd.apple.mpegurl', '/x.m3u8')).toBe(true);
    expect(contentTypeAllowed('video/mp2t', '/seg-1.ts')).toBe(true);
    expect(contentTypeAllowed('video/mp4', '/file.mp4')).toBe(true);
    expect(contentTypeAllowed('audio/aac', '/aud.aac')).toBe(true);
    expect(contentTypeAllowed('application/octet-stream', '/keys/dec.key?id=1')).toBe(true);
  });

  it('accepts known media extensions even with opaque content types', () => {
    expect(contentTypeAllowed('application/octet-stream', '/seg-2.ts')).toBe(true);
    expect(contentTypeAllowed('binary/octet-stream', '/chunk.mp4')).toBe(true);
  });

  it('rejects non-media content types', () => {
    expect(contentTypeAllowed('text/html', '/index')).toBe(false);
    expect(contentTypeAllowed('application/json', '/data')).toBe(false);
    expect(contentTypeAllowed(null, '/stream')).toBe(false);
  });
});
