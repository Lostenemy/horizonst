-- /vernemq/share/lua/bcrypt.lua
-- Wrapper para cargar bcrypt.so en el runtime limitado de vmq_diversity

local ok, mod = pcall(require, "bcrypt.so")
if ok then
  return mod
end

local ok2, mod2 = pcall(package.loadlib, "/vernemq/share/lua/bcrypt.so", "luaopen_bcrypt")
if ok2 and mod2 then
  return mod2()
end

error("cannot load bcrypt module (bcrypt.so). Ensure bcrypt.so exists in /vernemq/share/lua and exports luaopen_bcrypt")
