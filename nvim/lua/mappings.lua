require "nvchad.mappings"

-- add yours here

local map = vim.keymap.set

map("n", ";", ":", { desc = "CMD enter command mode" })
map("i", "jk", "<ESC>")

-- ===== Navigation de code (style IDE) — nécessite un LSP actif =====
-- Aller à la définition : Ctrl+clic ET clic droit
-- (sur macOS, Ctrl+clic = clic droit : les deux mènent à la définition)
map("n", "<C-LeftMouse>", "<LeftMouse><cmd>lua vim.lsp.buf.definition()<CR>", { desc = "LSP définition (ctrl+clic)" })
map("n", "<RightMouse>", "<LeftMouse><cmd>lua vim.lsp.buf.definition()<CR>", { desc = "LSP définition (clic droit)" })

-- Retour / avant (jumplist) : Ctrl-o / Ctrl-i  (⌥←/→ sont pris par tmux pour les panes)
map("n", "<X1Mouse>", "<C-o>", { desc = "Nav: retour (souris)" })
map("n", "<X2Mouse>", "<C-i>", { desc = "Nav: avant (souris)" })

-- Ctrl-i (= Tab dans un terminal) doit faire "go forward", comme Ctrl-o fait "go back".
-- NvChad mappait Tab/Shift+Tab sur le changement de buffer -> on les libère,
-- et on déplace le changement de buffer sur gt / gT (faciles en AZERTY, gardent H/L).
pcall(vim.keymap.del, "n", "<Tab>")
pcall(vim.keymap.del, "n", "<S-Tab>")
map("n", "gt", function()
  require("nvchad.tabufline").next()
end, { desc = "Buffer/onglet suivant" })
map("n", "gT", function()
  require("nvchad.tabufline").prev()
end, { desc = "Buffer/onglet précédent" })

-- Changement d'onglet INTUITIF : Shift+L (suivant) / Shift+H (précédent)
-- (remplace les motions H/L haut/bas d'écran, peu utilisées ; gt/gT restent dispo)
map("n", "L", function()
  require("nvchad.tabufline").next()
end, { desc = "Onglet suivant" })
map("n", "H", function()
  require("nvchad.tabufline").prev()
end, { desc = "Onglet précédent" })

-- Aide-mémoire Vim perso : <espace>?  ou  :Cheat
require "cheat"

-- map({ "n", "i", "v" }, "<C-s>", "<cmd> w <cr>")
