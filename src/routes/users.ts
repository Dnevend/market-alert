import { Hono } from "hono";
import { z } from "zod";
import { UserDB, type UpdateUserData } from "../db/users";
import { badRequest, notFound } from "../lib/errors";
import { logger } from "../lib/logger";
import type { AppContext } from "../types";

const users = new Hono<AppContext>();

// 用户数据验证模式
const updateProfileSchema = z.object({
  nickname: z.string().min(1).max(50).optional(),
  avatar_url: z.string().url().optional(),
  preferences: z.string().optional(),
});

// GET /users/profile - 获取当前用户资料
users.get("/users/profile", async (c) => {
  const userAddress = c.get("userAddress");
  const userDB = new UserDB(c.env.DB);

  try {
    const user = await userDB.findByAddress(userAddress);

    if (!user) {
      // 如果用户不存在，自动创建
      const newUser = await userDB.getOrCreate(userAddress);
      return c.json({
        success: true,
        data: newUser,
      });
    }

    return c.json({
      success: true,
      data: user,
    });
  } catch (error) {
    logger.error("get_user_profile_failed", {
      address: userAddress,
      error: `${error}`
    });
    throw badRequest("Failed to get user profile");
  }
});

// PUT /users/profile - 更新当前用户资料
users.put("/users/profile", async (c) => {
  const userAddress = c.get("userAddress");
  const userDB = new UserDB(c.env.DB);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("Invalid JSON payload");
  }

  const parse = updateProfileSchema.safeParse(body);
  if (!parse.success) {
    throw badRequest("Invalid request body", { issues: parse.error.issues });
  }

  const updateData = parse.data;

  try {
    // 先获取或创建用户
    const existingUser = await userDB.getOrCreate(userAddress);

    // 更新用户信息
    const updatedUser = await userDB.updateByAddress(userAddress, updateData);

    if (!updatedUser) {
      throw badRequest("Failed to update user profile");
    }

    logger.info("user_profile_updated", {
      userId: updatedUser.id,
      address: userAddress,
      fields: Object.keys(updateData)
    });

    return c.json({
      success: true,
      data: updatedUser,
    });
  } catch (error) {
    logger.error("update_user_profile_failed", {
      address: userAddress,
      error: `${error}`
    });
    throw badRequest("Failed to update user profile");
  }
});

export default users;