import { isIPv4, isIPv6 } from 'node:net';
import { networkInterfaces } from 'node:os';

/**
 * True for addresses that can only come from your own network:
 * loopback, the private LAN ranges (10.x, 172.16-31.x, 192.168.x), link-local,
 * and their IPv6 equivalents. Anything else is the public internet.
 */
export function isPrivateAddress(address: string | undefined): boolean {
  if (!address) return false;
  let ip = address;
  // Node reports IPv4 clients on a dual-stack socket as "::ffff:192.168.1.5".
  if (ip.toLowerCase().startsWith('::ffff:') && isIPv4(ip.slice(7))) ip = ip.slice(7);

  if (isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return (
      lower === '::1' ||
      lower.startsWith('fc') || // fc00::/7 unique local
      lower.startsWith('fd') ||
      /^fe[89ab]/.test(lower) // fe80::/10 link-local
    );
  }
  return false;
}

/** Adapters that are almost never the one your phone's Wi-Fi is on. */
const VIRTUAL_ADAPTER = /vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|zerotier|tailscale|hamachi|radmin|vpn|tap|tun|bluetooth/i;
const REAL_ADAPTER = /^(wi-?fi|wlan|wireless|ethernet|eth\d|en\d|wl)/i;

export interface LanAddress {
  address: string;
  adapter: string;
}

/**
 * This PC's LAN IPv4 addresses, most likely first: real Ethernet/Wi-Fi adapters, then others,
 * then virtual/VPN adapters (Hyper-V "vEthernet", ZeroTier, ...) last. Seen on a real PC: the
 * Hyper-V switch had a 192.168.x address too, so the address range alone isn't enough.
 */
export function lanAddressList(): LanAddress[] {
  const found: LanAddress[] = [];
  for (const [adapter, list] of Object.entries(networkInterfaces())) {
    for (const nic of list ?? []) {
      if (nic.family === 'IPv4' && !nic.internal && isPrivateAddress(nic.address) && !nic.address.startsWith('169.254.')) {
        found.push({ address: nic.address, adapter });
      }
    }
  }
  const rank = ({ address, adapter }: LanAddress) =>
    (VIRTUAL_ADAPTER.test(adapter) ? 20 : REAL_ADAPTER.test(adapter) ? 0 : 10) + (address.startsWith('192.168.') ? 0 : 1);
  return found.sort((x, y) => rank(x) - rank(y));
}

export function lanAddresses(): string[] {
  return lanAddressList().map((a) => a.address);
}
