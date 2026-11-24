-- ~/.hammerspoon/init.lua
-- Quake-style drop-down toggle for Alacritty, bound to a global hotkey.

-- Settings.
local appName = "Alacritty"
local widthFraction = 0.95 -- drop-down width, as a fraction of the screen width
local heightFraction = 1.0 -- drop-down height, as a fraction of the screen height

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

-- Claude Code banners, sent by bin/claude-tmux-wait as hammerspoon://claude?target=@12&title=...&body=...
-- No banner while Alacritty is frontmost: the tmux marker already shows it.
-- Click: bring Alacritty forward and jump to the tmux window that sent it.
-- Permission for a short Bash command: an "Autoriser" button answers Yes, after claude-tmux-wait checks the
-- pane still shows that exact prompt (otherwise it jumps there instead). A frozen Claude gets "Relancer":
-- claude-tmux-wait nudge interrupts the stuck turn and asks it to resume, after checking it is still stuck.
-- Kept in Notification Center (withdrawAfter = 0); full history in tmux: prefix N.
local claudeOk, claudeErr = pcall(function()
  local waitCmd = os.getenv("HOME") .. "/.local/bin/claude-tmux-wait"
  hs.urlevent.bind("claude", function(_, p)
    local target = p.target or ""
    if not target:match("^@%d+$") then
      return -- any app can open a hammerspoon:// URL: accept a tmux window id only
    end
    local app = hs.application.find(appName)
    if app and app:isFrontmost() then
      return
    end
    local pane, cmd, act = p.pane or "", p.cmd or "", p.act or ""
    local validPane = pane:match("^%%%d+$") ~= nil
    local canApprove = validPane and cmd ~= ""
    local canNudge = validPane and act == "nudge"
    hs.notify
      .new(function(n)
        if n:activationType() == hs.notify.activationTypes.actionButtonClicked then
          if canApprove then
            hs.task.new(waitCmd, nil, { "approve", pane, cmd }):start()
            return
          elseif canNudge then
            hs.task.new(waitCmd, nil, { "nudge", pane }):start()
            return
          end
        end
        local a = hs.application.find(appName)
        if a then
          showApp(a)
        else
          hs.application.launchOrFocus(appName)
        end
        hs.task.new(waitCmd, nil, { "goto", target }):start()
      end, {
        hasActionButton = canApprove or canNudge,
        actionButtonTitle = canApprove and "Autoriser" or "Relancer",
        title = p.title or "Claude",
        subTitle = p.subtitle or "",
        informativeText = p.body or "",
        soundName = (p.sound == "1") and hs.notify.defaultNotificationSound or nil,
        withdrawAfter = 0,
      })
      :send()
  end)
end)
-- Every 3 min: flag a Claude that loops (claude-tmux-wait watch). Global, or the timer is garbage-collected.
claudeWatchTimer = hs.timer.doEvery(180, function()
  hs.task.new(os.getenv("HOME") .. "/.local/bin/claude-tmux-wait", nil, { "watch" }):start()
end)

if not claudeOk then
  hs.alert.show("Notifications Claude : " .. tostring(claudeErr))
end

-- Load feedback + Accessibility check (global hotkeys require Accessibility permission).
if hs.accessibilityState() then
  hs.alert.show("Hammerspoon chargé")
else
  hs.alert.show("Hammerspoon chargé — ⚠️ Accessibilité requise pour le raccourci")
  hs.accessibilityState(true) -- opens the macOS Accessibility prompt
end
