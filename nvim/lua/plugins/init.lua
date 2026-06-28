return {
  {
    "stevearc/conform.nvim",
    -- event = 'BufWritePre', -- uncomment for format on save
    opts = require "configs.conform",
  },

  {
    "neovim/nvim-lspconfig",
    config = function()
      require "configs.lspconfig"
    end,
  },

  -- Coloration syntaxique fine pour ton stack
  {
    "nvim-treesitter/nvim-treesitter",
    opts = {
      ensure_installed = {
        "vim", "vimdoc", "lua", "bash",
        "go", "gomod", "gosum", "gowork",
        "proto",
        "typescript", "tsx", "javascript",
        "json", "jsonc", "yaml",
        "markdown", "markdown_inline",
        "html", "css",
        "gitcommit", "git_rebase", "diff",
      },
    },
  },

  -- Installe automatiquement les LSP + formateurs (au 1er démarrage)
  {
    "WhoIsSethDaniel/mason-tool-installer.nvim",
    dependencies = { "williamboman/mason.nvim" },
    event = "VeryLazy",
    opts = {
      run_on_start = true,
      ensure_installed = {
        "lua-language-server", "stylua",
        "gopls", "goimports",
        "typescript-language-server", "prettierd",
        "json-lsp", "yaml-language-server", "marksman",
        "html-lsp", "css-lsp",
        "buf",
      },
    },
  },

  -- Recherche ULTRA-rapide : fd (fichiers, respecte .gitignore) + fzf-native (tri fuzzy natif)
  {
    "nvim-telescope/telescope.nvim",
    dependencies = {
      { "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
    },
    opts = function(_, opts)
      opts.extensions_list = opts.extensions_list or {}
      if not vim.tbl_contains(opts.extensions_list, "fzf") then
        table.insert(opts.extensions_list, "fzf")
      end
      opts.extensions = opts.extensions or {}
      opts.extensions.fzf = {}
      opts.pickers = opts.pickers or {}
      opts.pickers.find_files = {
        find_command = { "fd", "--type", "f", "--strip-cwd-prefix", "--hidden", "--exclude", ".git" },
      }
      return opts
    end,
    config = function(_, opts)
      local telescope = require "telescope"
      telescope.setup(opts)
      for _, ext in ipairs(opts.extensions_list or {}) do
        pcall(telescope.load_extension, ext)
      end
    end,
  },

  -- Panel SQL dans nvim (browse + requêtes), façon GoLand. <leader>D pour ouvrir.
  {
    "kristijanhusak/vim-dadbod-ui",
    dependencies = {
      { "tpope/vim-dadbod", lazy = true },
      { "kristijanhusak/vim-dadbod-completion", ft = { "sql", "mysql", "plsql" }, lazy = true },
    },
    cmd = { "DBUI", "DBUIToggle", "DBUIAddConnection", "DBUIFindBuffer" },
    init = function()
      vim.g.db_ui_use_nerd_fonts = 1
    end,
  },

  -- Autocomplétion SQL (tables/colonnes) : ajoute la source dadbod aux sources
  -- globales de cmp. Fiable (pas de souci de timing lazy) ; cette source ne
  -- propose des candidats que dans les buffers SQL connectés (b:db).
  {
    "hrsh7th/nvim-cmp",
    dependencies = { "kristijanhusak/vim-dadbod-completion" },
    opts = function(_, opts)
      local cmp = require "cmp"
      -- En SQL : colonnes/tables (dadbod) en PREMIER groupe ; le reste (lsp,
      -- snippets, buffer…) en repli, affiché seulement si dadbod ne matche rien.
      -- dadbod ne renvoie rien hors buffers SQL → comportement neutre ailleurs.
      opts.sources = cmp.config.sources(
        { { name = "vim-dadbod-completion" } },
        opts.sources or {}
      )
      return opts
    end,
  },
}
