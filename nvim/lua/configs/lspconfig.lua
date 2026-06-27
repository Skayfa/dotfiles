require("nvchad.configs.lspconfig").defaults()

-- Fichiers de conf buf reconnus comme 'buf-config' -> gérés par le LSP buf + coloration YAML
vim.filetype.add {
  filename = {
    ["buf.yaml"] = "buf-config",
    ["buf.gen.yaml"] = "buf-config",
    ["buf.work.yaml"] = "buf-config",
    ["buf.lock"] = "buf-config",
  },
}
vim.treesitter.language.register("yaml", "buf-config")

-- proto : LSP buf (`buf lsp serve`) ; chaque langage a son serveur
local servers = { "html", "cssls", "gopls", "ts_ls", "jsonls", "yamlls", "marksman", "buf_ls" }
vim.lsp.enable(servers)

-- read :h vim.lsp.config for changing options of lsp servers 
