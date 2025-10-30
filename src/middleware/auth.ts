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
    const userPayload = EthereumSigner.verifyJWT(token, env.jwtSecret);

    if (!userPayload) {
      logger.warn("jwt_auth_failed", { token: token.substring(0, 20) + "..." });
      throw unauthorized("Invalid or expired token");
    }

    // 设置用户地址和角色到上下文中
    c.set("userAddress", userPayload.address);
    c.set("userRole", userPayload.role);
    await next();

  } catch (error) {
    logger.error("ethereum_auth_error", { error: `${error}` });
      throw unauthorized("Authentication failed");
  }
};

// 角色验证中间件工厂函数
export const requireRole = (requiredRole: string): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    const userRole = c.get("userRole");
    const userAddress = c.get("userAddress");

    if (!userRole) {
      logger.warn("role_check_failed", { userAddress, reason: "no_role_in_context" });
      throw unauthorized("User role not found");
    }

    if (userRole !== requiredRole) {
      logger.warn("role_access_denied", {
        userAddress,
        userRole,
        requiredRole
      });
      throw unauthorized(`Access denied. Required role: ${requiredRole}`);
    }

    await next();
  };
};

// 管理员权限验证中间件
export const requireAdmin = requireRole("admin");

// 用户权限验证中间件（admin 或 user）
export const requireUser = async (c: AppContext, next: () => Promise<void>) => {
  const userRole = c.get("userRole");
  const userAddress = c.get("userAddress");

  if (!userRole) {
    logger.warn("role_check_failed", { userAddress, reason: "no_role_in_context" });
    throw unauthorized("User role not found");
  }

  if (userRole !== "admin" && userRole !== "user") {
    logger.warn("role_access_denied", {
      userAddress,
      userRole,
      requiredRole: "user or admin"
    });
    throw unauthorized("Access denied. User role required");
  }

  await next();
};

// 多角色验证中间件工厂函数
export const requireAnyRole = (roles: string[]): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    const userRole = c.get("userRole");
    const userAddress = c.get("userAddress");

    if (!userRole) {
      logger.warn("role_check_failed", { userAddress, reason: "no_role_in_context" });
      throw unauthorized("User role not found");
    }

    if (!roles.includes(userRole)) {
      logger.warn("role_access_denied", {
        userAddress,
        userRole,
        requiredRoles: roles
      });
      throw unauthorized(`Access denied. Required one of: ${roles.join(", ")}`);
    }

    await next();
  };
};

// 导出统一的认证中间件（别名）
export const requireAuth = requireEthereumAuth;
