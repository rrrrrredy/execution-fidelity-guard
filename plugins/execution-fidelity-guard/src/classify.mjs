// SPDX-License-Identifier: Apache-2.0
const READ_COMMANDS = new Set([
  "cat", "dir", "find", "get-childitem", "get-content", "get-filehash",
  "get-item", "head", "ls", "pwd", "resolve-path", "rg", "sed",
  "select-string", "tail", "test-path", "where", "where.exe",
]);

const GIT_VALUE_OPTIONS = new Set([
  "-c", "--config-env", "--exec-path", "--git-dir", "--namespace",
  "--super-prefix", "--work-tree",
]);
const GH_VALUE_OPTIONS = new Set(["-r", "--hostname", "--repo"]);
const NPM_VALUE_OPTIONS = new Set([
  "-w", "--cache", "--config", "--loglevel", "--prefix", "--registry", "--scope",
  "--userconfig", "--workspace",
]);
const PNPM_VALUE_OPTIONS = new Set([
  ...NPM_VALUE_OPTIONS, "-c", "--dir", "--filter", "--filter-prod",
]);
const YARN_VALUE_OPTIONS = new Set([...NPM_VALUE_OPTIONS, "--cwd"]);
const UV_VALUE_OPTIONS = new Set([
  "--cache-dir", "--config-file", "--directory", "--project", "--python",
]);
const POETRY_VALUE_OPTIONS = new Set([
  "-c", "-p", "--directory", "--project",
]);
const SUDO_VALUE_OPTIONS = new Set([
  "-c", "-g", "-h", "-p", "-r", "-t", "-u",
  "--chdir", "--command-timeout", "--group", "--host", "--prompt", "--role",
  "--type", "--user",
]);
const ENV_VALUE_OPTIONS = new Set([
  "-c", "-s", "-u", "--argv0", "--chdir", "--split-string", "--unset",
]);
const NICE_VALUE_OPTIONS = new Set(["-n", "--adjustment"]);
const TIMEOUT_VALUE_OPTIONS = new Set([
  "-k", "-s", "--kill-after", "--signal",
]);
const EXEC_VALUE_OPTIONS = new Set(["-a"]);
const TIME_VALUE_OPTIONS = new Set(["-f", "-o", "--format", "--output"]);
const MAX_SHELL_WRAPPER_DEPTH = 8;

function splitSegments(command) {
  const segments = [];
  let current = "";
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      current += char;
      if (char === quote && command[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "\n" || char === ";" || char === "|") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      if (char === "|" && command[index + 1] === "|") index += 1;
      continue;
    }
    if (char === "&") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      if (command[index + 1] === "&") index += 1;
      continue;
    }
    current += char;
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

function tokenize(segment) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index];
    if (quote) {
      if (char === quote && segment[index - 1] !== "\\") quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function executableName(token) {
  return String(token ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/i, "");
}

function discardWrapperOptions(
  tokens,
  optionsWithValues,
  allowAssignments = false,
  preserveShortCase = false,
) {
  while (tokens[0]) {
    const token = String(tokens[0]);
    if (allowAssignments && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      tokens.shift();
      continue;
    }
    if (token === "--") {
      tokens.shift();
      break;
    }
    if (!token.startsWith("-") || token === "-") break;
    const lower = token.toLowerCase();
    const optionSource =
      preserveShortCase && token.startsWith("-") && !token.startsWith("--")
        ? token
        : lower;
    const option = optionSource.split("=", 1)[0];
    tokens.shift();
    const joinedShortValue =
      option.length === 2 && lower.length > 2 && !lower.includes("=");
    if (
      !lower.includes("=") &&
      !joinedShortValue &&
      optionsWithValues.has(option) &&
      tokens[0]
    ) {
      tokens.shift();
    }
  }
}

function discardEnvWrapperOptions(tokens) {
  while (tokens[0]) {
    const token = String(tokens[0]);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      tokens.shift();
      continue;
    }
    if (token === "--") {
      tokens.shift();
      break;
    }
    let splitValue = null;
    if (token === "-S" || token === "--split-string") {
      tokens.shift();
      splitValue = tokens.shift() ?? "";
    } else if (token.startsWith("-S") && token.length > 2) {
      tokens.shift();
      splitValue = token.slice(2);
    } else if (token.toLowerCase().startsWith("--split-string=")) {
      tokens.shift();
      splitValue = token.slice(token.indexOf("=") + 1);
    }
    if (splitValue !== null) {
      while (splitValue.endsWith("\\") && tokens[0]) {
        splitValue = splitValue.slice(0, -1) + " " + tokens.shift();
      }
      tokens.unshift(...tokenize(splitValue));
      break;
    }
    if (!token.startsWith("-") || token === "-") break;
    const lower = token.toLowerCase();
    const option = lower.split("=", 1)[0];
    tokens.shift();
    const joinedShortValue =
      option.length === 2 && lower.length > 2 && !lower.includes("=");
    if (
      !lower.includes("=") &&
      !joinedShortValue &&
      ENV_VALUE_OPTIONS.has(option) &&
      tokens[0]
    ) {
      tokens.shift();
    }
  }
}

function commandTokens(segment) {
  const tokens = tokenize(segment);
  while (tokens.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
      tokens.shift();
      continue;
    }
    const exe = executableName(tokens[0]);
    if (tokens[0] === "&") {
      tokens.shift();
      continue;
    }
    if (exe === "command") {
      if (tokens[1] === "-v" || tokens[1] === "-V") break;
      tokens.shift();
      discardWrapperOptions(tokens, new Set());
      continue;
    }
    if (exe === "exec") {
      tokens.shift();
      discardWrapperOptions(tokens, EXEC_VALUE_OPTIONS);
      continue;
    }
    if (exe === "nohup") {
      tokens.shift();
      discardWrapperOptions(tokens, new Set());
      continue;
    }
    if (exe === "sudo") {
      tokens.shift();
      discardWrapperOptions(tokens, SUDO_VALUE_OPTIONS, false, true);
      continue;
    }
    if (exe === "env") {
      tokens.shift();
      discardEnvWrapperOptions(tokens);
      continue;
    }
    if (exe === "nice") {
      tokens.shift();
      discardWrapperOptions(tokens, NICE_VALUE_OPTIONS);
      continue;
    }
    if (exe === "timeout") {
      tokens.shift();
      discardWrapperOptions(tokens, TIMEOUT_VALUE_OPTIONS);
      if (tokens[0]) tokens.shift();
      continue;
    }
    if (exe === "time") {
      tokens.shift();
      discardWrapperOptions(tokens, TIME_VALUE_OPTIONS);
      continue;
    }
    break;
  }
  return tokens;
}

function wrappedShellCommand(tokens) {
  const exe = executableName(tokens[0]);
  const args = tokens.slice(1);
  const lower = args.map((item) => item.toLowerCase());
  let marker = -1;
  if (["bash", "sh", "zsh"].includes(exe)) {
    marker = lower.findIndex((item) => /^-[^-]*c[^-]*$/.test(item));
  } else if (["pwsh", "powershell"].includes(exe)) {
    marker = lower.findIndex((item) => ["-c", "-command"].includes(item));
  } else if (exe === "cmd") {
    marker = lower.findIndex((item) => ["/c", "/k"].includes(item));
  }
  return marker >= 0 && args[marker + 1]
    ? args.slice(marker + 1).join(" ")
    : null;
}

function firstNonOption(args, optionsWithValues = new Set()) {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index].toLowerCase();
    if (value === "--") {
      return args[index + 1]
        ? { value: args[index + 1].toLowerCase(), index: index + 1 }
        : null;
    }
    if (!value.startsWith("-") || value === "-") {
      return { value, index };
    }
    const option = value.split("=", 1)[0];
    if (!value.includes("=") && optionsWithValues.has(option)) index += 1;
  }
  return null;
}

function commandView(args, optionsWithValues = new Set()) {
  const entry = firstNonOption(args, optionsWithValues);
  return entry
    ? { name: entry.value, args: args.slice(entry.index + 1) }
    : { name: null, args: [] };
}

function isReadOnlyGitBranch(args) {
  if (!args.length) return true;
  const mutationOptions = [
    "-c", "-f", "-m", "--copy", "--edit-description", "--force", "--move",
    "--set-upstream-to", "--unset-upstream",
  ];
  if (
    args.some((token) =>
      mutationOptions.some((option) => token === option || token.startsWith(option + "=")),
    )
  ) return false;
  const readFlags = new Set([
    "-a", "-i", "-l", "-r", "-v", "-vv", "--all", "--ignore-case", "--list",
    "--no-abbrev", "--no-color", "--no-column", "--remotes", "--show-current",
    "--verbose",
  ]);
  const readValueOptions = new Set([
    "--abbrev", "--color", "--column", "--contains", "--format", "--merged",
    "--no-contains", "--no-merged", "--points-at", "--sort",
  ]);
  let listing = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--") return listing;
    if (readFlags.has(token)) {
      listing = true;
      continue;
    }
    const option = token.split("=", 1)[0];
    if (readValueOptions.has(option)) {
      listing = true;
      if (!token.includes("=") && args[index + 1]) index += 1;
      continue;
    }
    if (token.startsWith("-") || !listing) return false;
  }
  return listing;
}

function optionValue(args, names) {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (names.includes(token)) return args[index + 1] ?? null;
    for (const name of names) {
      if (token.startsWith(name + "=")) return token.slice(name.length + 1);
      if (name.length === 2 && token.startsWith(name) && token.length > 2) {
        return token.slice(name.length);
      }
    }
  }
  return null;
}

function isInstall(tokens) {
  const exe = executableName(tokens[0]);
  const args = tokens.slice(1).map((item) => item.toLowerCase());
  const pipValueOptions = new Set([
    "--cache-dir", "--cert", "--client-cert", "--exists-action", "--log",
    "--extra-index-url", "--find-links", "--index-url", "--proxy", "--python",
    "--retries", "--timeout", "--trusted-host",
  ]);
  const systemValueOptions = new Set([
    "--color", "--config-file", "--option", "--target-release", "-c", "-o", "-t",
  ]);
  const pipCommand = firstNonOption(args, pipValueOptions)?.value;
  if (/^pip(?:3(?:\.\d+)?)?$/.test(exe) && pipCommand === "install") return true;
  const moduleIndex = args.indexOf("-m");
  if (
    (exe === "py" || /^python(?:3(?:\.\d+)?)?$/.test(exe)) &&
    moduleIndex >= 0 &&
    args[moduleIndex + 1] === "pip" &&
    firstNonOption(args.slice(moduleIndex + 2), pipValueOptions)?.value === "install"
  ) return true;
  if (
    String(tokens[0] ?? "").startsWith("$") &&
    moduleIndex >= 0 &&
    args[moduleIndex + 1] === "pip" &&
    firstNonOption(args.slice(moduleIndex + 2), pipValueOptions)?.value === "install"
  ) return true;
  const uvCommand = firstNonOption(args, UV_VALUE_OPTIONS);
  if (
    exe === "uv" &&
    ((uvCommand?.value === "pip" &&
      firstNonOption(args.slice(uvCommand.index + 1), pipValueOptions)?.value ===
        "install") ||
      uvCommand?.value === "add" ||
      uvCommand?.value === "sync" ||
      uvCommand?.value === "update" ||
      uvCommand?.value === "run")
  ) return true;
  const npmView = commandView(args, NPM_VALUE_OPTIONS);
  const npmCommand = npmView.name;
  if (
    exe === "npm" &&
    [
      "add", "install", "i", "ci", "link", "exec", "x", "create",
      "rebuild", "up", "update",
    ].includes(npmCommand)
  ) return true;
  if (
    exe === "npm" &&
    npmCommand === "audit" &&
    npmView.args.some((item) => item === "fix" || item === "--fix")
  ) return true;
  const packageManagerView =
    exe === "pnpm"
      ? commandView(args, PNPM_VALUE_OPTIONS)
      : exe === "yarn"
        ? commandView(args, YARN_VALUE_OPTIONS)
        : commandView(args, NPM_VALUE_OPTIONS);
  const packageManagerCommand = packageManagerView.name;
  if (
    ["pnpm", "yarn", "bun"].includes(exe) &&
    [
      "install", "add", "i", "create", "rebuild", "up", "update",
      "upgrade",
    ].includes(packageManagerCommand)
  ) return true;
  if (
    ["pnpm", "yarn", "bun"].includes(exe) &&
    packageManagerCommand === "audit" &&
    packageManagerView.args.some((item) => item === "fix" || item === "--fix")
  ) return true;
  if (
    exe === "yarn" &&
    packageManagerCommand === "global" &&
    ["add", "upgrade"].includes(firstNonOption(packageManagerView.args)?.value)
  ) return true;
  const systemCommand = firstNonOption(args, systemValueOptions)?.value;
  const dependencyChangingVerbs = {
    cargo: ["add", "install", "update"],
    go: ["get", "install"],
    gem: ["install", "update"],
    conda: ["create", "install", "update", "upgrade"],
    mamba: ["create", "install", "update", "upgrade"],
    winget: ["install", "upgrade", "update"],
    choco: ["install", "upgrade", "update"],
    scoop: ["install", "update"],
    brew: ["install", "reinstall", "upgrade"],
    apt: ["dist-upgrade", "full-upgrade", "install", "upgrade"],
    "apt-get": ["dist-upgrade", "full-upgrade", "install", "upgrade"],
    dnf: ["distro-sync", "install", "update", "upgrade"],
    yum: ["install", "update", "upgrade"],
  };
  if (dependencyChangingVerbs[exe]?.includes(systemCommand)) return true;
  if (
    ["conda", "mamba"].includes(exe) &&
    systemCommand === "env" &&
    ["create", "update"].includes(firstNonOption(args.slice((firstNonOption(args, systemValueOptions)?.index ?? -1) + 1))?.value)
  ) return true;
  if (
    exe === "poetry" &&
    ["add", "install", "sync", "update"].includes(
      firstNonOption(args, POETRY_VALUE_OPTIONS)?.value,
    )
  ) return true;
  if (
    exe === "pipenv" &&
    (!args[0] || ["install", "sync", "update"].includes(args[0]))
  ) {
    return true;
  }
  if (exe === "bundle" && ["install", "update"].includes(args[0])) return true;
  if (
    exe === "dotnet" &&
    args[0] === "tool" &&
    ["install", "update"].includes(args[1])
  ) return true;
  if (exe === "dotnet" && args[0] === "add" && args[1] === "package") return true;
  if (exe === "npx" || exe === "uvx" || exe === "bunx") return true;
  if (
    ["pnpm", "yarn"].includes(exe) &&
    packageManagerCommand === "dlx"
  ) return true;
  if (exe === "pipx" && ["install", "run"].includes(args[0])) return true;
  if (
    exe === "corepack" &&
    ["install", "prepare", "use"].includes(args[0])
  ) return true;
  if (
    exe === "codex" &&
    args[0] === "plugin" &&
    (args[1] === "add" || (args[1] === "marketplace" && args[2] === "add"))
  ) return true;
  if (exe === "dsh" && args[0] === "plugin" && args[1] === "add") return true;
  if (exe === "gem" && args[0] === "update") return true;
  return exe === "install-package" || exe === "install-module";
}

function hasOutputRedirect(segment) {
  let quote = null;
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index];
    if (quote) {
      if (char === quote && segment[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === ">" && segment[index + 1] !== ">") return true;
  }
  return false;
}

function classifySegment(segment, depth = 0) {
  const tokens = commandTokens(segment);
  const exe = executableName(tokens[0]);
  const rawArgs = tokens.slice(1);
  const args = rawArgs.map((item) => item.toLowerCase());
  const git = exe === "git" ? commandView(args, GIT_VALUE_OPTIONS) : null;
  const npm = exe === "npm" ? commandView(args, NPM_VALUE_OPTIONS) : null;
  const gh = exe === "gh" ? commandView(args, GH_VALUE_OPTIONS) : null;
  const ghSubcommand =
    gh &&
    [
      "gist", "issue", "pr", "release", "repo", "run", "secret", "variable",
      "workflow",
    ].includes(gh.name)
      ? commandView(gh.args, GH_VALUE_OPTIONS)
      : null;
  const ghApiMethod =
    gh?.name === "api" ? optionValue(gh.args, ["-x", "--method"]) : null;
  const ghApiHasImplicitBody =
    gh?.name === "api" &&
    !ghApiMethod &&
    gh.args.some((value) =>
      ["-f", "--field", "--input", "--raw-field"].some(
        (option) =>
          value === option ||
          value.startsWith(option + "=") ||
          (option === "-f" && value.startsWith("-f") && value.length > 2),
      ),
    );
  const gitPushDeletes =
    git?.name === "push" &&
    (git.args.includes("--delete") ||
      git.args.some((value) => value.startsWith(":") && value.length > 1));
  const ghResourceDeletes =
    ["repo", "release"].includes(gh?.name) && ghSubcommand?.name === "delete";
  const ghApiDeletes = gh?.name === "api" && ghApiMethod === "delete";
  const tags = new Set();
  if (!exe) return tags;
  if (exe === "command" && (tokens[1] === "-v" || tokens[1] === "-V")) {
    tags.add("read");
    return tags;
  }
  if (depth < MAX_SHELL_WRAPPER_DEPTH) {
    const wrapped = wrappedShellCommand(tokens);
    if (wrapped) {
      for (const nested of splitSegments(wrapped)) {
        for (const tag of classifySegment(nested, depth + 1)) tags.add(tag);
      }
      if (tags.size) return tags;
    }
  }
  if (isInstall(tokens)) {
    tags.add("install_local");
    tags.add("write_workspace");
    tags.add("network");
    return tags;
  }
  const packageMutation =
    (exe === "npm" &&
      ["dedupe", "prune", "remove", "rm", "uninstall", "unlink"].includes(
        npm?.name,
      )) ||
    (["pnpm", "yarn", "bun"].includes(exe) &&
      ["dedupe", "prune", "remove", "rm", "uninstall", "unlink"].includes(
        commandView(
          args,
          exe === "pnpm"
            ? PNPM_VALUE_OPTIONS
            : exe === "yarn"
              ? YARN_VALUE_OPTIONS
              : NPM_VALUE_OPTIONS,
        ).name,
      )) ||
    (exe === "yarn" &&
      commandView(args, YARN_VALUE_OPTIONS).name === "global" &&
      firstNonOption(commandView(args, YARN_VALUE_OPTIONS).args)?.value === "remove") ||
    (exe === "dotnet" &&
      args[0] === "tool" &&
      ["remove", "uninstall"].includes(args[1]));
  if (packageMutation) {
    tags.add("write_workspace");
    tags.add("network");
    return tags;
  }
  if (
    (git?.name === "push") ||
    (ghSubcommand &&
      ["repo", "release", "pr", "issue", "gist"].includes(gh.name) &&
      ["create", "edit", "delete"].includes(ghSubcommand.name)) ||
    (npm && ["publish", "unpublish", "deprecate"].includes(npm.name))
  ) {
    tags.add("publish");
    tags.add("external_side_effect");
    tags.add("network");
    if (gitPushDeletes || ghResourceDeletes) {
      tags.add("delete");
      tags.add("destructive");
    }
    return tags;
  }
  if (
    gh &&
    ((gh.name === "pr" &&
      ["merge", "close", "reopen", "ready", "review", "comment"].includes(
        ghSubcommand?.name,
      )) ||
      (gh.name === "issue" &&
        [
          "close", "reopen", "pin", "unpin", "lock", "unlock", "transfer",
          "comment",
        ].includes(ghSubcommand?.name)) ||
      (gh.name === "release" &&
        ["upload", "delete-asset"].includes(ghSubcommand?.name)) ||
      (gh.name === "repo" &&
        ["archive", "rename", "sync"].includes(ghSubcommand?.name)) ||
      (["secret", "variable"].includes(gh.name) &&
        ["delete", "remove", "set"].includes(ghSubcommand?.name)) ||
      (gh.name === "run" &&
        ["cancel", "delete", "rerun"].includes(ghSubcommand?.name)) ||
      (gh.name === "workflow" && ghSubcommand?.name === "run") ||
      (gh.name === "api" &&
        (["post", "put", "patch", "delete"].includes(ghApiMethod) ||
          ghApiHasImplicitBody)))
  ) {
    tags.add("external_side_effect");
    tags.add("network");
    if (ghApiDeletes) {
      tags.add("delete");
      tags.add("destructive");
    }
    return tags;
  }
  if (
    ["rm", "rmdir", "del", "erase", "remove-item"].includes(exe) ||
    (exe === "find" && args.includes("-delete")) ||
    (git?.name === "rm") ||
    (git &&
      (git.name === "clean" ||
        (git.name === "reset" && git.args.includes("--hard")) ||
        (git.name === "branch" &&
          (git.args.includes("-d") || git.args.includes("--delete"))) ||
        (git.name === "tag" &&
          (git.args.includes("-d") || git.args.includes("--delete"))) ||
        (git.name === "stash" &&
          ["drop", "clear"].includes(commandView(git.args).name)) ||
        (git.name === "worktree" &&
          ["remove", "prune"].includes(commandView(git.args).name))))
  ) {
    tags.add("delete");
    tags.add("destructive");
    return tags;
  }
  if (
    [
      "add-content", "clear-content", "copy-item", "cp", "export-clixml",
      "export-csv", "mkdir", "move-item", "mv", "new-item", "out-file",
      "rename-item", "set-content", "start-transcript", "tee", "touch",
    ].includes(exe) ||
    (exe === "sed" &&
      args.some((value) => value === "-i" || value.startsWith("-i.") ||
        value === "--in-place" || value.startsWith("--in-place="))) ||
    hasOutputRedirect(segment)
  ) {
    tags.add("write_workspace");
    return tags;
  }
  const inspectionOnly = args.some((value) =>
    ["--help", "--version"].includes(value),
  );
  if (
    (!inspectionOnly &&
      ["chmod", "chown", "install", "ln", "truncate"].includes(exe)) ||
    (exe === "patch" &&
      !args.some((value) => value === "--dry-run" || value === "--help" || value === "--version")) ||
    (exe === "dd" && args.some((value) => value.startsWith("of=")))
  ) {
    tags.add("write_workspace");
    return tags;
  }
  if (exe === "git") {
    const nested = commandView(git.args);
    if (
      ["status", "diff", "log", "show", "rev-parse", "ls-files"].includes(git.name) ||
      (git.name === "branch" && isReadOnlyGitBranch(git.args)) ||
      (git.name === "stash" && ["list", "show"].includes(nested.name)) ||
      (git.name === "worktree" && nested.name === "list")
    ) tags.add("read");
    else if (
      [
        "add", "am", "apply", "checkout", "cherry-pick", "commit", "merge",
        "branch", "rebase", "remote", "restore", "revert", "stash", "switch",
        "tag", "worktree",
      ].includes(git.name)
    ) tags.add("write_workspace");
    else tags.add("unknown");
    return tags;
  }
  if (READ_COMMANDS.has(exe)) {
    tags.add("read");
    return tags;
  }
  const curlMethod = exe === "curl" ? optionValue(args, ["-x", "--request"]) : null;
  const curlHasBody =
    exe === "curl" &&
    rawArgs.some((raw) => {
      const lower = raw.toLowerCase();
      return (
        raw === "-F" || raw.startsWith("-F") ||
        raw === "-T" || raw.startsWith("-T") ||
        lower === "-d" || lower.startsWith("-d") ||
        [
          "--data", "--data-ascii", "--data-binary", "--data-raw", "--form",
          "--form-string", "--json", "--upload-file",
        ].some((option) => lower === option || lower.startsWith(option + "="))
      );
    });
  const wgetMethod = exe === "wget" ? optionValue(args, ["--method"]) : null;
  const wgetHasBody =
    exe === "wget" &&
    args.some((value) =>
      ["--body-data", "--body-file", "--post-data", "--post-file"].some(
        (option) => value === option || value.startsWith(option + "="),
      ),
    );
  const powerShellMethod =
    ["invoke-restmethod", "invoke-webrequest", "irm", "iwr"].includes(exe)
      ? optionValue(args, ["-method"])
      : null;
  const mutatingHttpMethods = new Set([
    "connect", "delete", "patch", "post", "put", "trace",
  ]);
  if (
    (exe === "curl" &&
      (curlHasBody || mutatingHttpMethods.has(String(curlMethod).toLowerCase()))) ||
    (exe === "wget" &&
      (wgetHasBody || mutatingHttpMethods.has(String(wgetMethod).toLowerCase()))) ||
    (["invoke-restmethod", "invoke-webrequest", "irm", "iwr"].includes(exe) &&
      mutatingHttpMethods.has(String(powerShellMethod).toLowerCase()))
  ) {
    tags.add("external_side_effect");
    tags.add("network");
    const method =
      exe === "curl"
        ? curlMethod
        : exe === "wget"
          ? wgetMethod
          : powerShellMethod;
    if (String(method).toLowerCase() === "delete") {
      tags.add("delete");
      tags.add("destructive");
    }
    return tags;
  }
  if (["curl", "wget", "invoke-restmethod", "invoke-webrequest", "irm", "iwr"].includes(exe)) {
    tags.add("network");
    return tags;
  }
  tags.add("unknown");
  return tags;
}

function classifyNamedTool(toolName) {
  const qualified = toolName.toLowerCase();
  const lower = qualified.includes("__")
    ? qualified.split("__").filter(Boolean).at(-1)
    : qualified;
  const tags = new Set();
  if (
    lower === "automation_update" ||
    lower === "request_plugin_install" ||
    lower.startsWith("reorder_")
  ) {
    tags.add("external_side_effect");
    if (lower === "request_plugin_install") {
      tags.add("install_local");
      tags.add("write_workspace");
      tags.add("network");
    }
    return tags;
  }
  if (
    [
      "create_goal",
      "get_goal",
      "list_agents",
      "update_goal",
      "update_plan",
      "wait_agent",
    ].includes(lower)
  ) {
    tags.add("read");
    return tags;
  }
  if (/^(read|get|list|view|search|find|open|status|capture)(?:_|$)/.test(lower)) {
    tags.add("read");
    return tags;
  }
  if (lower === "apply_patch" || lower === "edit" || lower === "write") {
    tags.add("write_workspace");
    return tags;
  }
  const words = lower.split("_").filter(Boolean);
  const first = words[0] ?? lower;
  const last = words.at(-1) ?? lower;
  const destructive = new Set(["delete", "remove", "archive", "uninstall"]);
  if (destructive.has(first) || destructive.has(last)) {
    tags.add("delete");
    tags.add("external_side_effect");
    return tags;
  }
  const mutating = new Set([
    "add", "approve", "cancel", "close", "consume", "create", "fork", "handoff",
    "install", "merge", "move", "post", "publish", "push", "redeem", "rename",
    "reopen", "reorder", "reply", "restore", "send", "set", "share", "update",
  ]);
  if (mutating.has(first) || mutating.has(last)) {
    tags.add("external_side_effect");
    if (first === "install" || last === "install") {
      tags.add("install_local");
      tags.add("write_workspace");
      tags.add("network");
    }
    return tags;
  }
  tags.add("unknown");
  return tags;
}

export function classifyToolAction(input) {
  const toolName = String(input.tool_name ?? "unknown");
  const command =
    toolName.toLowerCase() === "bash"
      ? String(input.tool_input?.command ?? "")
      : "";
  const tags = new Set();
  if (command) {
    for (const segment of splitSegments(command)) {
      for (const tag of classifySegment(segment)) tags.add(tag);
    }
  } else {
    for (const tag of classifyNamedTool(toolName)) tags.add(tag);
  }
  if (!tags.size) tags.add("unknown");
  return {
    toolName,
    command,
    tags: [...tags].sort(),
    reversible:
      !tags.has("delete") &&
      !tags.has("destructive") &&
      !tags.has("install_local") &&
      !tags.has("publish") &&
      !tags.has("external_side_effect") &&
      !tags.has("write_workspace"),
    highRisk: [...tags].some((tag) =>
      ["delete", "destructive", "install_local", "publish", "external_side_effect"].includes(tag),
    ),
  };
}
