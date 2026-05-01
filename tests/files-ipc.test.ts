import { describe, expect, test } from "bun:test";
import {
  fileExistsJs,
  fileNewJs,
  fileOpenJs,
  fileSaveAsNoPromptJs,
  getDeviceCountJs,
  getFileBinaryContentsChunkJs,
  getFileBinaryContentsJs,
  getFileBinaryLengthJs,
  getFileCheckSumJs,
  getFileMagicHexJs,
  getFileSizeJs,
  getPtTempDirJs,
  removeFileJs,
  writeBinaryToFileJs,
} from "../src/ipc/files.js";

describe("fileSaveAsNoPromptJs", () => {
  test("calls AppWindow.fileSaveAsNoPrompt with quoted path and overwrite=true", () => {
    const js = fileSaveAsNoPromptJs("/tmp/foo.pkt");
    expect(js).toContain("ipc.appWindow()");
    expect(js).toContain('fileSaveAsNoPrompt("/tmp/foo.pkt",true)');
    expect(js).toContain('return "OK"');
    expect(js).toContain("ERR:");
  });

  test("escapes embedded quotes and backslashes in path", () => {
    const js = fileSaveAsNoPromptJs('/tmp/has "quote".pkt');
    expect(js).toContain('"/tmp/has \\"quote\\".pkt"');
  });
});

describe("fileOpenJs", () => {
  test("calls AppWindow.fileOpen and returns OK|<typeof>|<value>", () => {
    const js = fileOpenJs("/tmp/foo.pkt");
    expect(js).toContain('fileOpen("/tmp/foo.pkt")');
    expect(js).toContain('"OK|"');
    expect(js).toContain("typeof r");
  });
});

describe("fileNewJs", () => {
  test("true forwards true to AppWindow.fileNew", () => {
    expect(fileNewJs(true)).toContain("fileNew(true)");
  });
  test("false forwards false (no modal path)", () => {
    expect(fileNewJs(false)).toContain("fileNew(false)");
  });
});

describe("SystemFileManager helpers", () => {
  test("fileExistsJs delegates to systemFileManager().fileExists", () => {
    const js = fileExistsJs("/tmp/x.pkt");
    expect(js).toContain("ipc.systemFileManager()");
    expect(js).toContain('fileExists("/tmp/x.pkt")');
  });

  test("getFileSizeJs returns String(getFileSize(...))", () => {
    const js = getFileSizeJs("/tmp/x.pkt");
    expect(js).toContain("getFileSize(\"/tmp/x.pkt\")");
    expect(js).toContain("String(");
  });

  test("getFileCheckSumJs delegates to getFileCheckSum", () => {
    expect(getFileCheckSumJs("/tmp/x.pkt")).toContain('getFileCheckSum("/tmp/x.pkt")');
  });

  test("removeFileJs delegates to removeFile", () => {
    expect(removeFileJs("/tmp/x.pkt")).toContain('removeFile("/tmp/x.pkt")');
  });
});

describe("getFileMagicHexJs", () => {
  test("clamps n to [1,32] and emits HEX| protocol", () => {
    const small = getFileMagicHexJs("/tmp/x", 8);
    expect(small).toContain("getFileBinaryContents(\"/tmp/x\")");
    expect(small).toContain('"HEX|"');
    expect(small).toContain("bytes.length<8");
    const huge = getFileMagicHexJs("/tmp/x", 100);
    expect(huge).toContain("bytes.length<32");
    const zero = getFileMagicHexJs("/tmp/x", 0);
    expect(zero).toContain("bytes.length<1");
  });

  test("includes base64 alphabet for decode", () => {
    const js = getFileMagicHexJs("/tmp/x", 8);
    expect(js).toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
  });
});

describe("getDeviceCountJs", () => {
  test("returns String(getDeviceCount())", () => {
    expect(getDeviceCountJs()).toContain("String(ipc.network().getDeviceCount())");
  });
});

describe("getPtTempDirJs", () => {
  test("tries getUserFolder first then getDefaultFileSaveLocation", () => {
    const js = getPtTempDirJs();
    expect(js).toContain("getUserFolder()");
    expect(js).toContain("getDefaultFileSaveLocation()");
    expect(js).toContain('"DIR|"');
    expect(js).toContain("ERR:no_writable_dir");
  });
});

describe("getFileBinaryContentsJs", () => {
  test("wraps base64 result with LEN|<n>|<base64> protocol", () => {
    const js = getFileBinaryContentsJs("/tmp/x.pkt");
    expect(js).toContain('getFileBinaryContents("/tmp/x.pkt")');
    expect(js).toContain('"LEN|"+b.length+"|"+b');
    expect(js).toContain("ERR:");
  });
});

describe("getFileBinaryContentsChunkJs", () => {
  test("substring slice with floor + lower bounds", () => {
    const js = getFileBinaryContentsChunkJs("/tmp/x.pkt", 0, 4000);
    expect(js).toContain("substring(0,4000)");
    const js2 = getFileBinaryContentsChunkJs("/tmp/x.pkt", 12.7, 4000.9);
    expect(js2).toContain("substring(12,4012)");
    const js3 = getFileBinaryContentsChunkJs("/tmp/x.pkt", -5, 0);
    expect(js3).toContain("substring(0,1)");
  });
});

describe("getFileBinaryLengthJs", () => {
  test("returns String(b.length) or ERR", () => {
    const js = getFileBinaryLengthJs("/tmp/x.pkt");
    expect(js).toContain("getFileBinaryContents(\"/tmp/x.pkt\")");
    expect(js).toContain("String(b?b.length:-1)");
    expect(js).toContain("ERR:");
  });
});

describe("writeBinaryToFileJs", () => {
  test("calls writeBinaryToFile with quoted path and base64", () => {
    const js = writeBinaryToFileJs("/tmp/x.pkt", "AAAA");
    expect(js).toContain('writeBinaryToFile("/tmp/x.pkt","AAAA")');
    expect(js).toContain('"OK|"+(ok?"true":"false")');
  });

  test("escapes embedded quotes in base64 (defensive — base64 alphabet is safe but path/escape pipeline applies uniformly)", () => {
    // The standard base64 alphabet (A-Za-z0-9+/=) does not contain quote
    // chars, but if the caller passes weird input the escaping must hold.
    const js = writeBinaryToFileJs("/tmp/x.pkt", 'inj"ect');
    expect(js).toContain('"inj\\"ect"');
  });
});
