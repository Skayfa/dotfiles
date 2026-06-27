-- ~/.config/nvim/lua/cheat.lua
-- Helper perso : aide-mémoire Vim (fondamentaux + navigation de code).
-- Ouvrir : <espace>?  ou  :Cheat        Fermer : q ou <Échap>

local M = {}

local lines = {
  "  VIM — AIDE-MÉMOIRE                       q / Échap = fermer",
  "  ──────────────────────────────────────────────────────────",
  "",
  "  MODES",
  "    i  a  o        insérer : avant / après / nouvelle ligne",
  "    Échap          revenir en mode normal",
  "    v  V  Ctrl-v   visuel : caractère / ligne / bloc",
  "    :              ligne de commande",
  "",
  "  SE DÉPLACER",
  "    h j k l        gauche bas haut droite",
  "    w  b  e        mot suivant / précédent / fin de mot",
  "    0  ^  $        début de ligne / 1er non-blanc / fin",
  "    gg  G          début / fin du fichier",
  "    {  }           paragraphe précédent / suivant",
  "    Ctrl-d Ctrl-u  demi-page bas / haut",
  "    %              parenthèse/accolade correspondante",
  "",
  "  ÉDITER   (opérateur + mouvement : d=suppr · c=change · y=copie)",
  "    dd  yy  p P    couper / copier la ligne · coller après / avant",
  "    dw  d$  ciw    supprimer mot / fin de ligne / remplacer le mot",
  "    ci\"  ci(  cit  remplacer DANS \"…\"   (…)   <tag>…</tag>",
  "    x  r<x>  ~     suppr. caractère / remplacer / changer la casse",
  "    u  Ctrl-r  .   annuler / refaire / répéter la dernière action",
  "    >>  <<         indenter / désindenter",
  "",
  "  CHERCHER / REMPLACER",
  "    /texte   n N   chercher ; suivant / précédent",
  "    *              chercher le mot sous le curseur",
  "    :%s/a/b/g      remplacer a → b dans tout le fichier (gc = confirm.)",
  "",
  "  NAVIGATION DE CODE (LSP)",
  "    gd             aller à la DÉFINITION",
  "    Ctrl+clic / clic droit   aller à la définition (souris)",
  "    ⌥←  /  ⌥→      retour arrière / avant   (ou Ctrl-o / Ctrl-i)",
  "    gr  gi  K      références / implémentation / doc au survol",
  "    espace r n     renommer le symbole",
  "    espace c a     actions de code (quick fix)",
  "    [d  ]d         erreur précédente / suivante",
  "    espace f m     formater le fichier",
  "",
  "  FICHIERS / FENÊTRES",
  "    :w  :q  :wq    sauver / quitter / sauver + quitter   (ZZ = wq)",
  "    Ctrl-w v / s   split vertical / horizontal",
  "    Ctrl-w hjkl    aller au split voisin",
  "",
  "  TES OUTILS (NvChad)",
  "    espace (attendre)   which-key : montre TES raccourcis",
  "    espace c h          NvCheatsheet : tous les keymaps NvChad",
  "    espace f f          chercher un fichier (Telescope)",
  "    espace f w          chercher du texte dans le projet (live grep)",
  "    Ctrl-n              explorateur de fichiers (NvimTree)",
  "",
  "  → Rouvrir cet écran : espace + ?   ou   :Cheat",
}

function M.open()
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
  vim.bo[buf].bufhidden = "wipe"
  vim.bo[buf].filetype = "vimcheat"

  local width = 0
  for _, l in ipairs(lines) do
    width = math.max(width, vim.fn.strdisplaywidth(l))
  end
  width = math.min(width + 2, vim.o.columns - 4)
  local height = math.min(#lines, vim.o.lines - 4)

  local win = vim.api.nvim_open_win(buf, true, {
    relative = "editor",
    width = width,
    height = height,
    row = math.floor((vim.o.lines - height) / 2 - 1),
    col = math.floor((vim.o.columns - width) / 2),
    style = "minimal",
    border = "rounded",
    title = " Vim cheatsheet ",
    title_pos = "center",
  })
  -- force le focus dans la fenêtre flottante (sinon q/Échap partent ailleurs)
  vim.api.nvim_set_current_win(win)
  vim.wo[win].cursorline = true

  local function close()
    if vim.api.nvim_win_is_valid(win) then
      pcall(vim.api.nvim_win_close, win, true)
    end
  end

  -- q / Échap / Entrée / Tab / Shift+Tab ferment l'aide
  for _, key in ipairs({ "q", "<Esc>", "<CR>", "<Tab>", "<S-Tab>" }) do
    vim.keymap.set("n", key, close, { buffer = buf, nowait = true, silent = true })
  end

  -- ferme aussi automatiquement si on quitte la fenêtre ou si le buffer change
  vim.api.nvim_create_autocmd({ "WinLeave", "BufLeave" }, {
    buffer = buf,
    once = true,
    callback = function()
      vim.schedule(close)
    end,
  })
end

vim.api.nvim_create_user_command("Cheat", M.open, { desc = "Aide-mémoire Vim" })
vim.keymap.set("n", "<leader>?", M.open, { desc = "Aide-mémoire Vim", silent = true })

return M
