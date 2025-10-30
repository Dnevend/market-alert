import type { MiddlewareHandler } from "hono";
import { unauthorized } from "../lib/errors";
import { EthereumSigner } from "../lib/ethereum";
import { loadEnv } from "../config/env";
import { logger } from "../lib/logger";
import type { AppContext } from "../types";

// 以太坊签名认证中间件
export const requireEthereumAuth: MiddlewareHandler<AppContext> = async (c, next) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    throw unauthorized("Missing authorization token");
  }

  const env = loadEnv(c.env);

  try {
    const address = EthereumSigner.verifyJWT(token, env.jwtSecret);

    if (!address) {
      logger.warn("jwt_auth_failed", { token: token.substring(0, 20) + "..." });
      throw unauthorized("Invalid or expired token");
    }

    // 设置用户地址到上下文中
    c.set("userAddress", address);
    await next();

  } catch (error) {
    logger.error("ethereum_auth_error", { error: `${error}` });
      throw unauthorized("Authentication failed");
  }
};

// 导出统一的认证中间件（别名）
export const requireAuth = requireEthereumAuth;
