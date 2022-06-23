#!/usr/bin/env node

import { createHash } from "crypto";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "fs";

interface File {
  name: string;
  parent: string;
  path: string;
}

interface FileBKP {
  original: string;
  filename: string;
  copy: string;
}

  // Get execution path
const EXECPATH: string = process.cwd();
const TMPDIR: string | undefined = process.env.TMPDIR;
const CLITMPDIR = `${TMPDIR}/autoGit`;

const createCopies = (files: File[]): FileBKP[] => {
  if (!existsSync(CLITMPDIR)) {
    mkdirSync(CLITMPDIR);
  }

  // Create a hash for each file and relationed to the filepath in json

  const originalAndCopies: Array<FileBKP> = [];

  files.forEach((file) => {
    // create a md5 hash name for the file using the filepath
    const hash = createHash("md5");
    hash.update(file.path);
    const newFilename = hash.digest("hex");
    const newPath = `${CLITMPDIR}/${newFilename}`;
    const fileContent = readFileSync(file.path, "utf8");
    writeFileSync(newPath, fileContent);
    originalAndCopies.push({
      original: file.path,
      filename: file.name,
      copy: newPath,
    });
  });

  return originalAndCopies;
};

const deleteCopies = (bkps: FileBKP[]) => {
  bkps.forEach((file) => {
    const fileName = file.filename;
    const tmpFile = `${CLITMPDIR}/${fileName}`;
    if (existsSync(tmpFile)) {
      unlinkSync(tmpFile);
    }
  });
};

const restoreCopies = (bkps: FileBKP[]) => {
  bkps.forEach((file) => {
    const fileName = file.filename;
    const tmpFile = `${CLITMPDIR}/${fileName}`;
    if (existsSync(tmpFile)) {
      writeFileSync(file.original, readFileSync(tmpFile));
    }
  });
};

const parseCommitComments = (filename: string, comments: string[]) => {
  let commitMessage = `Arquivo: ${filename}:
    `;
  comments.forEach((comment) => {
    // Add new line to commit message
    commitMessage += `\n${comment}`;
  });

  commitMessage += `\n`;
  return commitMessage;
};

const getCommitComments = (
  filePath: string | undefined
): Array<string> | undefined => {
  if (!filePath) return undefined;
  // Get text starting with /*#COMMIT_MESSAGE and ending with #*/
  const text = readFileSync(filePath, "utf8");
  const regex = /\/\*#COMMIT_MESSAGE\n([\s\S]*?)#\*\//g;
  const match = regex.exec(text);
  if (match) {
    return [match[1]];
  }
  return [];
};

const deleteCommitComments = (filePath: string | undefined) => {
  if (!filePath) return;
  const text = readFileSync(filePath, "utf8");
  const regex = /\/\*#COMMIT_MESSAGE\n([\s\S]*?)#\*\//g;
  const match = regex.exec(text);
  if (match) {
    let newText = text.replace(regex, "");
    // remove starting blank lines
    newText = newText.replace(/^\n+/g, "");
    writeFileSync(filePath, newText);
  }
};

const doGitCommit = (filepaths: string[], message: string) => {
  const git = require("simple-git");
  git(EXECPATH).add(filepaths).commit(message);
}

const getCommitMessages = (
  filename: string,
  commitComments: string[]
): Array<string> => {
  const clearedMessages = commitComments.map((comment) => {
    return comment.replace(/\/\*#COMMIT_MESSAGE\n([\s\S]*?)#\*\//g, "");
  });

  const messages = clearedMessages.map((comment) => {
    return comment.split("\n").filter((line) => line.length > 0);
  });

  const parsedMessages = messages.map((message) => {
    return parseCommitComments(filename, message);
  });

  return parsedMessages;
};

const getParentDirectoryName = (path: string | undefined) => {
  if (!path) return undefined;
  const splitPath = path.split("/");
  return splitPath[splitPath.length - 2];
};

const getMessage = (
  files: {
    name: string | undefined;
    path: string | undefined;
  }[]
): string => {
  let commitComments: string[] = [];
  for (const file of files) {
    const comments = getCommitComments(file.path);
    const parent = getParentDirectoryName(file.path)
      ? getParentDirectoryName(file.path)
      : "";
    const filename = file.name ? file.name : "";
    if (comments) {
      commitComments = [
        ...commitComments,
        ...getCommitMessages(`${parent}/${filename}`, comments),
      ];
    }
  }

  const joinedMessages = commitComments.join("\n");
  return joinedMessages;
};

const Index = () => {
  let BKPS: FileBKP[] = [];
  try {
    const params: string[] = process.argv.slice(2);

    if (params.length < 1) {
      console.log("Usage: autoGit <filePaths>");
      process.exit(1);
    }

    // Transform paths to absolute paths
    const filePaths = params.map((path) => {
      if (path.startsWith("/")) {
        return path;
      } else if (path.startsWith("./")) {
        return `${EXECPATH}/${path.substring(2)}`;
      } else if (path.startsWith("'~/")) {
        return `${process.env.HOME}/${path.substring(2)}`;
      } else return `${EXECPATH}/${path}`;
    });

    const files: File[] = [];

    filePaths.forEach((path) => {
      const parent = getParentDirectoryName(path);
      const name = path.split("/").pop();
      if (parent && name) {
        files.push({
          path,
          parent,
          name,
        });
      }
    });

    if (!TMPDIR) {
      console.log("TMPDIR not set");
      process.exit(1);
    }

    BKPS = createCopies(files);

    const commitMessage = getMessage(files);

    files.forEach((file) => {
      deleteCommitComments(file.path);
    });

    doGitCommit(files.map((file) => file.path), commitMessage);
  } catch (error) {
    console.log(error);
    restoreCopies(BKPS);
  } finally {
    deleteCopies(BKPS);
  }
};

Index();
