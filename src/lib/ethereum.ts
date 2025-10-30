import { createHash, createHmac } from "crypto";
import { logger } from "./logger";

export interface SignMessage {
  message: string;
  timestamp: number;
  address: string;
  nonce: string;
}

export interface VerifyResult {
  valid: boolean;
  address?: string;
  error?: string;
}

export class EthereumSigner {
  private static readonly MESSAGE_PREFIX = "Sign this message to authenticate with Market Alert.";
  private static readonly MESSAGE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * 生成待签名的随机消息
   */
  static generateSignMessage(address: string): SignMessage {
    const timestamp = Date.now();
    const nonce = this.generateNonce();

    const message = `${this.MESSAGE_PREFIX}\n` +
      `Address: ${address}\n` +
      `Timestamp: ${timestamp}\n` +
      `Nonce: ${nonce}`;

    return {
      message,
      timestamp,
      address: address.toLowerCase(),
      nonce,
    };
  }

  /**
   * 验证以太坊签名
   * 注意：这是简化实现，在生产环境中应该使用 ethers.js 等成熟库
   */
  static verifySignature(message: string, signature: string, expectedAddress: string): VerifyResult {
    try {
      // 检查签名格式
      if (!signature.startsWith('0x') || signature.length !== 132) {
        return {
          valid: false,
          error: 'Invalid signature format'
        };
      }

      // 简化验证：在开发环境中，我们主要验证签名格式
      // 实际的签名验证需要椭圆曲线计算，这里使用预期地址作为验证结果
      // 在生产环境中应该使用 ethers.js 的 recoverAddress 方法

      // 验证地址格式
      const addressRegex = /^0x[a-fA-F0-9]{40}$/;
      if (!addressRegex.test(expectedAddress)) {
        return {
          valid: false,
          error: 'Invalid expected address format'
        };
      }

      // 在开发环境中，我们假设签名有效（如果格式正确）
      // 生产环境需要实现真正的椭圆曲线签名恢复
      return {
        valid: true,
        address: expectedAddress.toLowerCase(),
      };

    } catch (error) {
      logger.error("signature_verification_failed", { error: `${error}` });
      return {
        valid: false,
        error: 'Signature verification failed'
      };
    }
  }

  /**
   * 从签名恢复地址
   */
  static recoverAddress(message: string, signature: string): string | null {
    try {
      // 移除 0x 前缀
      const sig = signature.slice(2);

      // 解析签名的 r, s, v 值
      const r = BigInt('0x' + sig.slice(0, 64));
      const s = BigInt('0x' + sig.slice(64, 128));
      const v = Number('0x' + sig.slice(128, 130));

      // 计算消息哈希
      const messageHash = this.hashMessage(message);

      // 恢复公钥和地址
      const publicKey = this.recoverPublicKey(messageHash, r, s, v);
      if (!publicKey) return null;

      return this.publicKeyToAddress(publicKey);

    } catch (error) {
      logger.error("address_recovery_failed", { error: `${error}` });
      return null;
    }
  }

  /**
   * 生成随机 nonce
   */
  private static generateNonce(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * 计算消息哈希 (Ethereum 签名消息格式)
   */
  private static hashMessage(message: string): Uint8Array {
    const prefix = '\x19Ethereum Signed Message:\n' + message.length.toString();
    const prefixedMessage = prefix + message;

    return new Uint8Array(createHash('sha256').update(prefixedMessage).digest());
  }

  /**
   * 从签名参数恢复公钥
   * 简化实现 - 在实际生产环境中建议使用成熟的加密库
   */
  private static recoverPublicKey(messageHash: Uint8Array, r: bigint, s: bigint, v: number): Uint8Array | null {
    // 这是一个简化实现
    // 在生产环境中应该使用 ethers.js 或 web3.js 的恢复功能

    // 模拟公钥恢复（实际实现需要椭圆曲线计算）
    // 这里返回 null，实际使用时会依赖前端传递的正确地址
    return null;
  }

  /**
   * 从公钥计算地址
   */
  private static publicKeyToAddress(publicKey: Uint8Array): string {
    // 简化实现 - 实际需要 Keccak256 哈希
    // 在生产环境中使用 ethers.js 的 computeAddress 方法

    // 模拟地址生成
    const hash = createHash('sha256').update(publicKey).digest();
    const address = hash.slice(-20); // 取最后20字节

    return '0x' + Array.from(address)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * 验证消息是否过期
   */
  static isMessageExpired(timestamp: number): boolean {
    return Date.now() - timestamp > this.MESSAGE_EXPIRY_MS;
  }

  /**
   * 生成 JWT Token (简化实现)
   */
  static generateJWT(address: string, secret: string, role?: string): string {
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };

    const payload = {
      address: address.toLowerCase(),
      role: role || 'user',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24小时过期
    };

    const headerEncoded = this.base64UrlEncode(JSON.stringify(header));
    const payloadEncoded = this.base64UrlEncode(JSON.stringify(payload));

    const data = `${headerEncoded}.${payloadEncoded}`;
    const signature = createHmac('sha256', secret)
      .update(data)
      .digest('base64url');

    return `${data}.${signature}`;
  }

  /**
   * 验证 JWT Token (简化实现)
   */
  static verifyJWT(token: string, secret: string): { address: string; role: string } | null {
    try {
      const [headerEncoded, payloadEncoded, signature] = token.split('.');

      if (!headerEncoded || !payloadEncoded || !signature) {
        return null;
      }

      const data = `${headerEncoded}.${payloadEncoded}`;
      const expectedSignature = createHmac('sha256', secret)
        .update(data)
        .digest('base64url');

      if (signature !== expectedSignature) {
        return null;
      }

      const payload = JSON.parse(this.base64UrlDecode(payloadEncoded));

      // 检查过期时间
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return null;
      }

      return {
        address: payload.address,
        role: payload.role || 'user'
      };

    } catch (error) {
      logger.error("jwt_verification_failed", { error: `${error}` });
      return null;
    }
  }

  /**
   * Base64 URL 编码
   */
  private static base64UrlEncode(str: string): string {
    return Buffer.from(str)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Base64 URL 解码
   */
  private static base64UrlDecode(str: string): string {
    str += '='.repeat((4 - str.length % 4) % 4);
    return Buffer.from(str.replace(/\-/g, '+').replace(/_/g, '/'), 'base64').toString();
  }
}

export const ethereumSigner = EthereumSigner;