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

-- marksman (Markdown LSP) has an upstream bug: when a .md it indexed disappears
-- from disk (typically a branch switch), it crashes the whole server. Auto-restart
-- it on abnormal exit by re-triggering the FileType attach, with a loop guard.
do
  local guard = { last = 0, count = 0 }
  vim.lsp.config("marksman", {
    on_exit = function(code)
      if code == 0 then return end
      vim.schedule(function()
        local now = vim.uv.now()
        if now - guard.last > 30000 then guard.count = 0 end
        guard.last, guard.count = now, guard.count + 1
        if guard.count > 3 then
          vim.notify("marksman keeps crashing — auto-restart off", vim.log.levels.WARN)
          return
        end
        for _, buf in ipairs(vim.api.nvim_list_bufs()) do
          if vim.api.nvim_buf_is_loaded(buf) and vim.bo[buf].filetype == "markdown" then
            vim.api.nvim_exec_autocmds("FileType", { buffer = buf, modeline = false })
          end
        end
      end)
    end,
  })
end

-- proto : LSP buf (`buf lsp serve`) ; chaque langage a son serveur
local servers = { "html", "cssls", "gopls", "ts_ls", "jsonls", "yamlls", "marksman", "buf_ls" }
vim.lsp.enable(servers)

-- read :h vim.lsp.config for changing options of lsp servers 
