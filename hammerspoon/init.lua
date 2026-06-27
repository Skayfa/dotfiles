-- ~/.hammerspoon/init.lua
-- Quake-style drop-down toggle for Alacritty, bound to a global hotkey.

-- Settings.
local appName = "Alacritty"
local widthFraction = 0.90 -- drop-down width, as a fraction of the screen width
local heightFraction = 0.90 -- drop-down height, as a fraction of the screen height

-- Screen the drop-down should appear on (the one under the mouse).
local function dropScreen()
  return hs.mouse.getCurrentScreen() or hs.screen.mainScreen()
end

-- Snap a window to the top of the active screen, centered, at the configured size.
local function positionWindow(win)
  if not win then
    return
  end
  local f = dropScreen():frame()
  local w = f.w * widthFraction
  local h = f.h * heightFraction
  local x = f.x + (f.w - w) / 2 -- centered horizontally
  win:setFrame(hs.geometry.rect(x, f.y, w, h))
end

-- Bring the app to the front and place its window in the drop-down position.
local function showApp(app)
  app:unhide()
  app:activate(true)
  positionWindow(app:mainWindow() or app:allWindows()[1])
end

-- Toggle: frontmost -> hide; running -> show+position; not running -> launch+position.
local function toggleAlacritty()
  local app = hs.application.find(appName)
  if not app then
    hs.application.launchOrFocus(appName)
    local tries = 0
    hs.timer.waitUntil(
      function()
        tries = tries + 1
        local a = hs.application.find(appName)
        return (a ~= nil and a:mainWindow() ~= nil) or tries > 50
      end,
      function()
        local a = hs.application.find(appName)
        if a then
          showApp(a)
        end
      end,
      0.1
    )
    return
  end
  if app:isFrontmost() then
    app:hide()
  else
    showApp(app)
  end
end

-- Global hotkey: Ctrl + Alt + T.
hs.hotkey.bind({ "ctrl", "alt" }, "T", toggleAlacritty)

-- Load feedback + Accessibility check (global hotkeys require Accessibility permission).
if hs.accessibilityState() then
  hs.alert.show("Hammerspoon chargé")
else
  hs.alert.show("Hammerspoon chargé — ⚠️ Accessibilité requise pour le raccourci")
  hs.accessibilityState(true) -- opens the macOS Accessibility prompt
end
