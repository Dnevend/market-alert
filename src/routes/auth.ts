import { Hono } from "hono";
import { z } from "zod";
import { EthereumSigner } from "../lib/ethereum";
import { loadEnv } from "../config/env";
import { badRequest, unauthorized } from "../lib/errors";
import { logger } from "../lib/logger";
import type { AppContext } from "../types";

const auth = new Hono<AppContext>();

// GET /auth/message - 获取待签名的消息
const messageSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address"),
});

auth.get("/auth/message", (c) => {
  const parse = messageSchema.safeParse(c.req.query());
  if (!parse.success) {
    throw badRequest("Invalid address parameter", { issues: parse.error.issues });
  }

  const { address } = parse.data;
  const signMessage = EthereumSigner.generateSignMessage(address);

  logger.info("sign_message_generated", { address });

  return c.json({
    success: true,
    data: {
      message: signMessage.message,
      timestamp: signMessage.timestamp,
    },
  });
});

// POST /auth/verify - 验证签名并获取 token
const verifySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address"),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/, "Invalid signature format"),
});

auth.post("/auth/verify", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("Invalid JSON payload");
  }

  const parse = verifySchema.safeParse(body);
  if (!parse.success) {
    throw badRequest("Invalid request body", { issues: parse.error.issues });
  }

  const { address, signature } = parse.data;
  const env = loadEnv(c.env);

  try {
    // 生成原始消息
    const signMessage = EthereumSigner.generateSignMessage(address);

    // 验证签名
    const result = EthereumSigner.verifySignature(
      signMessage.message,
      signature,
      address
    );

    if (!result.valid) {
      logger.warn("signature_verification_failed", {
        address,
        signature,
        error: result.error
      });
      throw unauthorized("Invalid signature");
    }

    // 检查消息是否过期
    if (EthereumSigner.isMessageExpired(signMessage.timestamp)) {
      logger.warn("signature_expired", {
        address,
        timestamp: signMessage.timestamp
      });
      throw unauthorized("Signature has expired");
    }

    // 生成 JWT token
    const token = EthereumSigner.generateJWT(address, env.jwtSecret);

    logger.info("user_authenticated", {
      address: result.address,
      timestamp: Date.now()
    });

    return c.json({
      success: true,
      data: {
        token,
        address: result.address,
        expiresIn: 86400, // 24小时
      },
    });

  } catch (error) {
      if (error instanceof Error && error.message.includes("unauthorized")) {
        throw error;
      }

      logger.error("authentication_error", { error: `${error}` });
      throw badRequest("Authentication failed");
  }
});

// POST /auth/validate - 验证 JWT token 有效性
auth.post("/auth/validate", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    throw unauthorized("Missing authorization token");
  }

  const env = loadEnv(c.env);

  try {
    const address = EthereumSigner.verifyJWT(token, env.jwtSecret);

    if (!address) {
      logger.warn("jwt_validation_failed", { token: token.substring(0, 20) + "..." });
      throw unauthorized("Invalid or expired token");
    }

    return c.json({
      success: true,
      data: {
        valid: true,
        address,
      },
    });

  } catch (error) {
    logger.error("jwt_validation_error", { error: `${error}` });
    throw unauthorized("Token validation failed");
  }
});

// GET /auth/status - 检查认证状态
auth.get("/auth/status", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return c.json({
      success: true,
      data: {
        authenticated: false,
        address: null,
      },
    });
  }

  const env = loadEnv(c.env);

  try {
    const address = EthereumSigner.verifyJWT(token, env.jwtSecret);

    return c.json({
      success: true,
      data: {
        authenticated: !!address,
        address,
      },
    });

  } catch (error) {
    logger.error("auth_status_check_error", { error: `${error}` });

    return c.json({
      success: true,
      data: {
        authenticated: false,
        address: null,
      },
    });
  }
});

export default auth;