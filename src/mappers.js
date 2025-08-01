var utils = require("./utils");

var Mappers = {};

Mappers[0] = function (nes) {
  this.nes = nes;
};

Mappers[0].prototype = {
  reset: function () {
    this.joy1StrobeState = 0;
    this.joy2StrobeState = 0;
    this.joypadLastWrite = 0;

    this.zapperFired = false;
    this.zapperX = null;
    this.zapperY = null;
  },

  write: function (address, value) {
    if (address < 0x2000) {
      // Mirroring of RAM:
      this.nes.cpu.mem[address & 0x7ff] = value;
    } else if (address > 0x4017) {
      this.nes.cpu.mem[address] = value;
      if (address >= 0x6000 && address < 0x8000) {
        // Write to persistent RAM
        this.nes.opts.onBatteryRamWrite(address, value);
      }
    } else if (address > 0x2007 && address < 0x4000) {
      this.regWrite(0x2000 + (address & 0x7), value);
    } else {
      this.regWrite(address, value);
    }
  },

  writelow: function (address, value) {
    if (address < 0x2000) {
      // Mirroring of RAM:
      this.nes.cpu.mem[address & 0x7ff] = value;
    } else if (address > 0x4017) {
      this.nes.cpu.mem[address] = value;
    } else if (address > 0x2007 && address < 0x4000) {
      this.regWrite(0x2000 + (address & 0x7), value);
    } else {
      this.regWrite(address, value);
    }
  },

  load: function (address) {
    // Wrap around:
    address &= 0xffff;

    // Check address range:
    if (address > 0x4017) {
      // ROM:
      return this.nes.cpu.mem[address];
    } else if (address >= 0x2000) {
      // I/O Ports.
      return this.regLoad(address);
    } else {
      // RAM (mirrored)
      return this.nes.cpu.mem[address & 0x7ff];
    }
  },

  regLoad: function (address) {
    switch (
      address >> 12 // use fourth nibble (0xF000)
    ) {
      case 0:
        break;

      case 1:
        break;

      case 2:
      // Fall through to case 3
      case 3:
        // PPU Registers
        switch (address & 0x7) {
          case 0x0:
            // 0x2000:
            // PPU Control Register 1.
            // (the value is stored both
            // in main memory and in the
            // PPU as flags):
            // (not in the real NES)
            return this.nes.cpu.mem[0x2000];

          case 0x1:
            // 0x2001:
            // PPU Control Register 2.
            // (the value is stored both
            // in main memory and in the
            // PPU as flags):
            // (not in the real NES)
            return this.nes.cpu.mem[0x2001];

          case 0x2:
            // 0x2002:
            // PPU Status Register.
            // The value is stored in
            // main memory in addition
            // to as flags in the PPU.
            // (not in the real NES)
            return this.nes.ppu.readStatusRegister();

          case 0x3:
            return 0;

          case 0x4:
            // 0x2004:
            // Sprite Memory read.
            return this.nes.ppu.sramLoad();
          case 0x5:
            return 0;

          case 0x6:
            return 0;

          case 0x7:
            // 0x2007:
            // VRAM read:
            return this.nes.ppu.vramLoad();
        }
        break;
      case 4:
        // Sound+Joypad registers
        switch (address - 0x4015) {
          case 0:
            // 0x4015:
            // Sound channel enable, DMC Status
            return this.nes.papu.readReg(address);

          case 1:
            // 0x4016:
            // Joystick 1 + Strobe
            return this.joy1Read();

          case 2:
            // 0x4017:
            // Joystick 2 + Strobe
            // https://wiki.nesdev.com/w/index.php/Zapper
            var w;

            if (
              this.zapperX !== null &&
              this.zapperY !== null &&
              this.nes.ppu.isPixelWhite(this.zapperX, this.zapperY)
            ) {
              w = 0;
            } else {
              w = 0x1 << 3;
            }

            if (this.zapperFired) {
              w |= 0x1 << 4;
            }
            return (this.joy2Read() | w) & 0xffff;
        }
        break;
    }
    return 0;
  },

  regWrite: function (address, value) {
    switch (address) {
      case 0x2000:
        // PPU Control register 1
        this.nes.cpu.mem[address] = value;
        this.nes.ppu.updateControlReg1(value);
        break;

      case 0x2001:
        // PPU Control register 2
        this.nes.cpu.mem[address] = value;
        this.nes.ppu.updateControlReg2(value);
        break;

      case 0x2003:
        // Set Sprite RAM address:
        this.nes.ppu.writeSRAMAddress(value);
        break;

      case 0x2004:
        // Write to Sprite RAM:
        this.nes.ppu.sramWrite(value);
        break;

      case 0x2005:
        // Screen Scroll offsets:
        this.nes.ppu.scrollWrite(value);
        break;

      case 0x2006:
        // Set VRAM address:
        this.nes.ppu.writeVRAMAddress(value);
        break;

      case 0x2007:
        // Write to VRAM:
        this.nes.ppu.vramWrite(value);
        break;

      case 0x4014:
        // Sprite Memory DMA Access
        this.nes.ppu.sramDMA(value);
        break;

      case 0x4015:
        // Sound Channel Switch, DMC Status
        this.nes.papu.writeReg(address, value);
        break;

      case 0x4016:
        // Joystick 1 + Strobe
        if ((value & 1) === 0 && (this.joypadLastWrite & 1) === 1) {
          this.joy1StrobeState = 0;
          this.joy2StrobeState = 0;
        }
        this.joypadLastWrite = value;
        break;

      case 0x4017:
        // Sound channel frame sequencer:
        this.nes.papu.writeReg(address, value);
        break;

      default:
        // Sound registers
        // console.log("write to sound reg");
        if (address >= 0x4000 && address <= 0x4017) {
          this.nes.papu.writeReg(address, value);
        }
    }
  },

  joy1Read: function () {
    var ret;

    switch (this.joy1StrobeState) {
      case 0:
      case 1:
      case 2:
      case 3:
      case 4:
      case 5:
      case 6:
      case 7:
        ret = this.nes.controllers[1].state[this.joy1StrobeState];
        break;
      case 8:
      case 9:
      case 10:
      case 11:
      case 12:
      case 13:
      case 14:
      case 15:
      case 16:
      case 17:
      case 18:
        ret = 0;
        break;
      case 19:
        ret = 1;
        break;
      default:
        ret = 0;
    }

    this.joy1StrobeState++;
    if (this.joy1StrobeState === 24) {
      this.joy1StrobeState = 0;
    }

    return ret;
  },

  joy2Read: function () {
    var ret;

    switch (this.joy2StrobeState) {
      case 0:
      case 1:
      case 2:
      case 3:
      case 4:
      case 5:
      case 6:
      case 7:
        ret = this.nes.controllers[2].state[this.joy2StrobeState];
        break;
      case 8:
      case 9:
      case 10:
      case 11:
      case 12:
      case 13:
      case 14:
      case 15:
      case 16:
      case 17:
      case 18:
        ret = 0;
        break;
      case 19:
        ret = 1;
        break;
      default:
        ret = 0;
    }

    this.joy2StrobeState++;
    if (this.joy2StrobeState === 24) {
      this.joy2StrobeState = 0;
    }

    return ret;
  },

  loadROM: function () {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 1) {
      throw new Error("NoMapper: Invalid ROM! Unable to load.");
    }

    // Load ROM into memory:
    this.loadPRGROM();

    // Load CHR-ROM:
    this.loadCHRROM();

    // Load Battery RAM (if present):
    this.loadBatteryRam();

    // Reset IRQ:
    //nes.getCpu().doResetInterrupt();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  },

  loadPRGROM: function () {
    if (this.nes.rom.romCount > 1) {
      // Load the two first banks into memory.
      this.loadRomBank(0, 0x8000);
      this.loadRomBank(1, 0xc000);
    } else {
      // Load the one bank into both memory locations:
      this.loadRomBank(0, 0x8000);
      this.loadRomBank(0, 0xc000);
    }
  },

  loadCHRROM: function () {
    // console.log("Loading CHR ROM..");
    if (this.nes.rom.vromCount > 0) {
      if (this.nes.rom.vromCount === 1) {
        this.loadVromBank(0, 0x0000);
        this.loadVromBank(0, 0x1000);
      } else {
        this.loadVromBank(0, 0x0000);
        this.loadVromBank(1, 0x1000);
      }
    } else {
      //System.out.println("There aren't any CHR-ROM banks..");
    }
  },

  loadBatteryRam: function () {
    if (this.nes.rom.batteryRam) {
      var ram = this.nes.rom.batteryRam;
      if (ram !== null && ram.length === 0x2000) {
        // Load Battery RAM into memory:
        utils.copyArrayElements(ram, 0, this.nes.cpu.mem, 0x6000, 0x2000);
      }
    }
  },

  loadRomBank: function (bank, address) {
    // Loads a ROM bank into the specified address.
    bank %= this.nes.rom.romCount;
    //var data = this.nes.rom.rom[bank];
    //cpuMem.write(address,data,data.length);
    utils.copyArrayElements(
      this.nes.rom.rom[bank],
      0,
      this.nes.cpu.mem,
      address,
      16384,
    );
  },

  loadVromBank: function (bank, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    utils.copyArrayElements(
      this.nes.rom.vrom[bank % this.nes.rom.vromCount],
      0,
      this.nes.ppu.vramMem,
      address,
      4096,
    );

    var vromTile = this.nes.rom.vromTile[bank % this.nes.rom.vromCount];
    utils.copyArrayElements(
      vromTile,
      0,
      this.nes.ppu.ptTile,
      address >> 4,
      256,
    );
  },

  load32kRomBank: function (bank, address) {
    this.loadRomBank((bank * 2) % this.nes.rom.romCount, address);
    this.loadRomBank((bank * 2 + 1) % this.nes.rom.romCount, address + 16384);
  },

  load8kVromBank: function (bank4kStart, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    this.loadVromBank(bank4kStart % this.nes.rom.vromCount, address);
    this.loadVromBank(
      (bank4kStart + 1) % this.nes.rom.vromCount,
      address + 4096,
    );
  },

  load1kVromBank: function (bank1k, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    var bank4k = Math.floor(bank1k / 4) % this.nes.rom.vromCount;
    var bankoffset = (bank1k % 4) * 1024;
    utils.copyArrayElements(
      this.nes.rom.vrom[bank4k],
      bankoffset,
      this.nes.ppu.vramMem,
      address,
      1024,
    );

    // Update tiles:
    var vromTile = this.nes.rom.vromTile[bank4k];
    var baseIndex = address >> 4;
    for (var i = 0; i < 64; i++) {
      this.nes.ppu.ptTile[baseIndex + i] = vromTile[(bank1k % 4 << 6) + i];
    }
  },

  load2kVromBank: function (bank2k, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    var bank4k = Math.floor(bank2k / 2) % this.nes.rom.vromCount;
    var bankoffset = (bank2k % 2) * 2048;
    utils.copyArrayElements(
      this.nes.rom.vrom[bank4k],
      bankoffset,
      this.nes.ppu.vramMem,
      address,
      2048,
    );

    // Update tiles:
    var vromTile = this.nes.rom.vromTile[bank4k];
    var baseIndex = address >> 4;
    for (var i = 0; i < 128; i++) {
      this.nes.ppu.ptTile[baseIndex + i] = vromTile[(bank2k % 2 << 7) + i];
    }
  },

  load8kRomBank: function (bank8k, address) {
    var bank16k = Math.floor(bank8k / 2) % this.nes.rom.romCount;
    var offset = (bank8k % 2) * 8192;

    //this.nes.cpu.mem.write(address,this.nes.rom.rom[bank16k],offset,8192);
    utils.copyArrayElements(
      this.nes.rom.rom[bank16k],
      offset,
      this.nes.cpu.mem,
      address,
      8192,
    );
  },

  clockIrqCounter: function () {
    // Does nothing. This is used by the MMC3 mapper.
  },

  // eslint-disable-next-line no-unused-vars
  latchAccess: function (address) {
    // Does nothing. This is used by MMC2.
  },

  toJSON: function () {
    return {
      joy1StrobeState: this.joy1StrobeState,
      joy2StrobeState: this.joy2StrobeState,
      joypadLastWrite: this.joypadLastWrite,
    };
  },

  fromJSON: function (s) {
    this.joy1StrobeState = s.joy1StrobeState;
    this.joy2StrobeState = s.joy2StrobeState;
    this.joypadLastWrite = s.joypadLastWrite;
  },
};

Mappers[1] = function (nes) {
  this.nes = nes;
};

Mappers[1].prototype = new Mappers[0]();

Mappers[1].prototype.reset = function () {
  Mappers[0].prototype.reset.apply(this);

  // 5-bit buffer:
  this.regBuffer = 0;
  this.regBufferCounter = 0;

  // Register 0:
  this.mirroring = 0;
  this.oneScreenMirroring = 0;
  this.prgSwitchingArea = 1;
  this.prgSwitchingSize = 1;
  this.vromSwitchingSize = 0;

  // Register 1:
  this.romSelectionReg0 = 0;

  // Register 2:
  this.romSelectionReg1 = 0;

  // Register 3:
  this.romBankSelect = 0;
};

Mappers[1].prototype.write = function (address, value) {
  // Writes to addresses other than MMC registers are handled by NoMapper.
  if (address < 0x8000) {
    Mappers[0].prototype.write.apply(this, arguments);
    return;
  }

  // See what should be done with the written value:
  if ((value & 128) !== 0) {
    // Reset buffering:
    this.regBufferCounter = 0;
    this.regBuffer = 0;

    // Reset register:
    if (this.getRegNumber(address) === 0) {
      this.prgSwitchingArea = 1;
      this.prgSwitchingSize = 1;
    }
  } else {
    // Continue buffering:
    //regBuffer = (regBuffer & (0xFF-(1<<regBufferCounter))) | ((value & (1<<regBufferCounter))<<regBufferCounter);
    this.regBuffer =
      (this.regBuffer & (0xff - (1 << this.regBufferCounter))) |
      ((value & 1) << this.regBufferCounter);
    this.regBufferCounter++;

    if (this.regBufferCounter === 5) {
      // Use the buffered value:
      this.setReg(this.getRegNumber(address), this.regBuffer);

      // Reset buffer:
      this.regBuffer = 0;
      this.regBufferCounter = 0;
    }
  }
};

Mappers[1].prototype.setReg = function (reg, value) {
  var tmp;

  switch (reg) {
    case 0:
      // Mirroring:
      tmp = value & 3;
      if (tmp !== this.mirroring) {
        // Set mirroring:
        this.mirroring = tmp;
        if ((this.mirroring & 2) === 0) {
          // SingleScreen mirroring overrides the other setting:
          this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING);
        } else if ((this.mirroring & 1) !== 0) {
          // Not overridden by SingleScreen mirroring.
          this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
        } else {
          this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
        }
      }

      // PRG Switching Area;
      this.prgSwitchingArea = (value >> 2) & 1;

      // PRG Switching Size:
      this.prgSwitchingSize = (value >> 3) & 1;

      // VROM Switching Size:
      this.vromSwitchingSize = (value >> 4) & 1;

      break;

    case 1:
      // ROM selection:
      this.romSelectionReg0 = (value >> 4) & 1;

      // Check whether the cart has VROM:
      if (this.nes.rom.vromCount > 0) {
        // Select VROM bank at 0x0000:
        if (this.vromSwitchingSize === 0) {
          // Swap 8kB VROM:
          if (this.romSelectionReg0 === 0) {
            this.load8kVromBank(value & 0xf, 0x0000);
          } else {
            this.load8kVromBank(
              Math.floor(this.nes.rom.vromCount / 2) + (value & 0xf),
              0x0000,
            );
          }
        } else {
          // Swap 4kB VROM:
          if (this.romSelectionReg0 === 0) {
            this.loadVromBank(value & 0xf, 0x0000);
          } else {
            this.loadVromBank(
              Math.floor(this.nes.rom.vromCount / 2) + (value & 0xf),
              0x0000,
            );
          }
        }
      }

      break;

    case 2:
      // ROM selection:
      this.romSelectionReg1 = (value >> 4) & 1;

      // Check whether the cart has VROM:
      if (this.nes.rom.vromCount > 0) {
        // Select VROM bank at 0x1000:
        if (this.vromSwitchingSize === 1) {
          // Swap 4kB of VROM:
          if (this.romSelectionReg1 === 0) {
            this.loadVromBank(value & 0xf, 0x1000);
          } else {
            this.loadVromBank(
              Math.floor(this.nes.rom.vromCount / 2) + (value & 0xf),
              0x1000,
            );
          }
        }
      }
      break;

    default:
      // Select ROM bank:
      // -------------------------
      tmp = value & 0xf;
      var bank;
      var baseBank = 0;

      if (this.nes.rom.romCount >= 32) {
        // 1024 kB cart
        if (this.vromSwitchingSize === 0) {
          if (this.romSelectionReg0 === 1) {
            baseBank = 16;
          }
        } else {
          baseBank =
            (this.romSelectionReg0 | (this.romSelectionReg1 << 1)) << 3;
        }
      } else if (this.nes.rom.romCount >= 16) {
        // 512 kB cart
        if (this.romSelectionReg0 === 1) {
          baseBank = 8;
        }
      }

      if (this.prgSwitchingSize === 0) {
        // 32kB
        bank = baseBank + (value & 0xf);
        this.load32kRomBank(bank, 0x8000);
      } else {
        // 16kB
        bank = baseBank * 2 + (value & 0xf);
        if (this.prgSwitchingArea === 0) {
          this.loadRomBank(bank, 0xc000);
        } else {
          this.loadRomBank(bank, 0x8000);
        }
      }
  }
};

// Returns the register number from the address written to:
Mappers[1].prototype.getRegNumber = function (address) {
  if (address >= 0x8000 && address <= 0x9fff) {
    return 0;
  } else if (address >= 0xa000 && address <= 0xbfff) {
    return 1;
  } else if (address >= 0xc000 && address <= 0xdfff) {
    return 2;
  } else {
    return 3;
  }
};

Mappers[1].prototype.loadROM = function () {
  if (!this.nes.rom.valid) {
    throw new Error("MMC1: Invalid ROM! Unable to load.");
  }

  // Load PRG-ROM:
  this.loadRomBank(0, 0x8000); //   First ROM bank..
  this.loadRomBank(this.nes.rom.romCount - 1, 0xc000); // ..and last ROM bank.

  // Load CHR-ROM:
  this.loadCHRROM();

  // Load Battery RAM (if present):
  this.loadBatteryRam();

  // Do Reset-Interrupt:
  this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
};

// eslint-disable-next-line no-unused-vars
Mappers[1].prototype.switchLowHighPrgRom = function (oldSetting) {
  // not yet.
};

Mappers[1].prototype.switch16to32 = function () {
  // not yet.
};

Mappers[1].prototype.switch32to16 = function () {
  // not yet.
};

Mappers[1].prototype.toJSON = function () {
  var s = Mappers[0].prototype.toJSON.apply(this);
  s.mirroring = this.mirroring;
  s.oneScreenMirroring = this.oneScreenMirroring;
  s.prgSwitchingArea = this.prgSwitchingArea;
  s.prgSwitchingSize = this.prgSwitchingSize;
  s.vromSwitchingSize = this.vromSwitchingSize;
  s.romSelectionReg0 = this.romSelectionReg0;
  s.romSelectionReg1 = this.romSelectionReg1;
  s.romBankSelect = this.romBankSelect;
  s.regBuffer = this.regBuffer;
  s.regBufferCounter = this.regBufferCounter;
  return s;
};

Mappers[1].prototype.fromJSON = function (s) {
  Mappers[0].prototype.fromJSON.apply(this, arguments);
  this.mirroring = s.mirroring;
  this.oneScreenMirroring = s.oneScreenMirroring;
  this.prgSwitchingArea = s.prgSwitchingArea;
  this.prgSwitchingSize = s.prgSwitchingSize;
  this.vromSwitchingSize = s.vromSwitchingSize;
  this.romSelectionReg0 = s.romSelectionReg0;
  this.romSelectionReg1 = s.romSelectionReg1;
  this.romBankSelect = s.romBankSelect;
  this.regBuffer = s.regBuffer;
  this.regBufferCounter = s.regBufferCounter;
};

Mappers[2] = function (nes) {
  this.nes = nes;
};

Mappers[2].prototype = new Mappers[0]();

Mappers[2].prototype.write = function (address, value) {
  // Writes to addresses other than MMC registers are handled by NoMapper.
  if (address < 0x8000) {
    Mappers[0].prototype.write.apply(this, arguments);
    return;
  } else {
    // This is a ROM bank select command.
    // Swap in the given ROM bank at 0x8000:
    this.loadRomBank(value, 0x8000);
  }
};

Mappers[2].prototype.loadROM = function () {
  if (!this.nes.rom.valid) {
    throw new Error("UNROM: Invalid ROM! Unable to load.");
  }

  // Load PRG-ROM:
  this.loadRomBank(0, 0x8000);
  this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);

  // Load CHR-ROM:
  this.loadCHRROM();

  // Do Reset-Interrupt:
  this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
};

/**
 * Mapper 003 (CNROM)
 *
 * @constructor
 * @example Solomon's Key, Arkanoid, Arkista's Ring, Bump 'n' Jump, Cybernoid
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_003
 */
Mappers[3] = function (nes) {
  this.nes = nes;
};

Mappers[3].prototype = new Mappers[0]();

Mappers[3].prototype.write = function (address, value) {
  // Writes to addresses other than MMC registers are handled by NoMapper.
  if (address < 0x8000) {
    Mappers[0].prototype.write.apply(this, arguments);
    return;
  } else {
    // This is a ROM bank select command.
    // Swap in the given ROM bank at 0x8000:
    // This is a VROM bank select command.
    // Swap in the given VROM bank at 0x0000:
    var bank = (value % (this.nes.rom.vromCount / 2)) * 2;
    this.loadVromBank(bank, 0x0000);
    this.loadVromBank(bank + 1, 0x1000);
    this.load8kVromBank(value * 2, 0x0000);
  }
};

Mappers[4] = function (nes) {
  this.nes = nes;

  this.CMD_SEL_2_1K_VROM_0000 = 0;
  this.CMD_SEL_2_1K_VROM_0800 = 1;
  this.CMD_SEL_1K_VROM_1000 = 2;
  this.CMD_SEL_1K_VROM_1400 = 3;
  this.CMD_SEL_1K_VROM_1800 = 4;
  this.CMD_SEL_1K_VROM_1C00 = 5;
  this.CMD_SEL_ROM_PAGE1 = 6;
  this.CMD_SEL_ROM_PAGE2 = 7;

  this.command = null;
  this.prgAddressSelect = null;
  this.chrAddressSelect = null;
  this.pageNumber = null;
  this.irqCounter = null;
  this.irqLatchValue = null;
  this.irqEnable = null;
  this.prgAddressChanged = false;
};

Mappers[4].prototype = new Mappers[0]();

Mappers[4].prototype.write = function (address, value) {
  // Writes to addresses other than MMC registers are handled by NoMapper.
  if (address < 0x8000) {
    Mappers[0].prototype.write.apply(this, arguments);
    return;
  }

  switch (address) {
    case 0x8000:
      // Command/Address Select register
      this.command = value & 7;
      var tmp = (value >> 6) & 1;
      if (tmp !== this.prgAddressSelect) {
        this.prgAddressChanged = true;
      }
      this.prgAddressSelect = tmp;
      this.chrAddressSelect = (value >> 7) & 1;
      break;

    case 0x8001:
      // Page number for command
      this.executeCommand(this.command, value);
      break;

    case 0xa000:
      // Mirroring select
      if ((value & 1) !== 0) {
        this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
      } else {
        this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
      }
      break;

    case 0xa001:
      // SaveRAM Toggle
      // TODO
      //nes.getRom().setSaveState((value&1)!=0);
      break;

    case 0xc000:
      // IRQ Counter register
      this.irqCounter = value;
      //nes.ppu.mapperIrqCounter = 0;
      break;

    case 0xc001:
      // IRQ Latch register
      this.irqLatchValue = value;
      break;

    case 0xe000:
      // IRQ Control Reg 0 (disable)
      //irqCounter = irqLatchValue;
      this.irqEnable = 0;
      break;

    case 0xe001:
      // IRQ Control Reg 1 (enable)
      this.irqEnable = 1;
      break;

    default:
    // Not a MMC3 register.
    // The game has probably crashed,
    // since it tries to write to ROM..
    // IGNORE.
  }
};

Mappers[4].prototype.executeCommand = function (cmd, arg) {
  switch (cmd) {
    case this.CMD_SEL_2_1K_VROM_0000:
      // Select 2 1KB VROM pages at 0x0000:
      if (this.chrAddressSelect === 0) {
        this.load1kVromBank(arg, 0x0000);
        this.load1kVromBank(arg + 1, 0x0400);
      } else {
        this.load1kVromBank(arg, 0x1000);
        this.load1kVromBank(arg + 1, 0x1400);
      }
      break;

    case this.CMD_SEL_2_1K_VROM_0800:
      // Select 2 1KB VROM pages at 0x0800:
      if (this.chrAddressSelect === 0) {
        this.load1kVromBank(arg, 0x0800);
        this.load1kVromBank(arg + 1, 0x0c00);
      } else {
        this.load1kVromBank(arg, 0x1800);
        this.load1kVromBank(arg + 1, 0x1c00);
      }
      break;

    case this.CMD_SEL_1K_VROM_1000:
      // Select 1K VROM Page at 0x1000:
      if (this.chrAddressSelect === 0) {
        this.load1kVromBank(arg, 0x1000);
      } else {
        this.load1kVromBank(arg, 0x0000);
      }
      break;

    case this.CMD_SEL_1K_VROM_1400:
      // Select 1K VROM Page at 0x1400:
      if (this.chrAddressSelect === 0) {
        this.load1kVromBank(arg, 0x1400);
      } else {
        this.load1kVromBank(arg, 0x0400);
      }
      break;

    case this.CMD_SEL_1K_VROM_1800:
      // Select 1K VROM Page at 0x1800:
      if (this.chrAddressSelect === 0) {
        this.load1kVromBank(arg, 0x1800);
      } else {
        this.load1kVromBank(arg, 0x0800);
      }
      break;

    case this.CMD_SEL_1K_VROM_1C00:
      // Select 1K VROM Page at 0x1C00:
      if (this.chrAddressSelect === 0) {
        this.load1kVromBank(arg, 0x1c00);
      } else {
        this.load1kVromBank(arg, 0x0c00);
      }
      break;

    case this.CMD_SEL_ROM_PAGE1:
      if (this.prgAddressChanged) {
        // Load the two hardwired banks:
        if (this.prgAddressSelect === 0) {
          this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0xc000);
        } else {
          this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0x8000);
        }
        this.prgAddressChanged = false;
      }

      // Select first switchable ROM page:
      if (this.prgAddressSelect === 0) {
        this.load8kRomBank(arg, 0x8000);
      } else {
        this.load8kRomBank(arg, 0xc000);
      }
      break;

    case this.CMD_SEL_ROM_PAGE2:
      // Select second switchable ROM page:
      this.load8kRomBank(arg, 0xa000);

      // hardwire appropriate bank:
      if (this.prgAddressChanged) {
        // Load the two hardwired banks:
        if (this.prgAddressSelect === 0) {
          this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0xc000);
        } else {
          this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0x8000);
        }
        this.prgAddressChanged = false;
      }
  }
};

Mappers[4].prototype.loadROM = function () {
  if (!this.nes.rom.valid) {
    throw new Error("MMC3: Invalid ROM! Unable to load.");
  }

  // Load hardwired PRG banks (0xC000 and 0xE000):
  this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0xc000);
  this.load8kRomBank((this.nes.rom.romCount - 1) * 2 + 1, 0xe000);

  // Load swappable PRG banks (0x8000 and 0xA000):
  this.load8kRomBank(0, 0x8000);
  this.load8kRomBank(1, 0xa000);

  // Load CHR-ROM:
  this.loadCHRROM();

  // Load Battery RAM (if present):
  this.loadBatteryRam();

  // Do Reset-Interrupt:
  this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
};

Mappers[4].prototype.clockIrqCounter = function () {
  if (this.irqEnable === 1) {
    this.irqCounter--;
    if (this.irqCounter < 0) {
      // Trigger IRQ:
      //nes.getCpu().doIrq();
      this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
      this.irqCounter = this.irqLatchValue;
    }
  }
};

Mappers[4].prototype.toJSON = function () {
  var s = Mappers[0].prototype.toJSON.apply(this);
  s.command = this.command;
  s.prgAddressSelect = this.prgAddressSelect;
  s.chrAddressSelect = this.chrAddressSelect;
  s.pageNumber = this.pageNumber;
  s.irqCounter = this.irqCounter;
  s.irqLatchValue = this.irqLatchValue;
  s.irqEnable = this.irqEnable;
  s.prgAddressChanged = this.prgAddressChanged;
  return s;
};

Mappers[4].prototype.fromJSON = function (s) {
  Mappers[0].prototype.fromJSON.apply(this, arguments);
  this.command = s.command;
  this.prgAddressSelect = s.prgAddressSelect;
  this.chrAddressSelect = s.chrAddressSelect;
  this.pageNumber = s.pageNumber;
  this.irqCounter = s.irqCounter;
  this.irqLatchValue = s.irqLatchValue;
  this.irqEnable = s.irqEnable;
  this.prgAddressChanged = s.prgAddressChanged;
};

/**
 * Mapper005 (MMC5,ExROM)
 *
 * @example Castlevania 3, Just Breed, Uncharted Waters, Romance of the 3 Kingdoms 2, Laser Invasion, Metal Slader Glory, Uchuu Keibitai SDF, Shin 4 Nin Uchi Mahjong - Yakuman Tengoku
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_005
 * @constructor
 */
Mappers[5] = function (nes) {
  this.nes = nes;
};

Mappers[5].prototype = new Mappers[0]();

Mappers[5].prototype.write = function (address, value) {
  // Writes to addresses other than MMC registers are handled by NoMapper.
  if (address < 0x8000) {
    Mappers[0].prototype.write.apply(this, arguments);
  } else {
    this.load8kVromBank(value, 0x0000);
  }
};

Mappers[5].prototype.write = function (address, value) {
  // Writes to addresses other than MMC registers are handled by NoMapper.
  if (address < 0x5000) {
    Mappers[0].prototype.write.apply(this, arguments);
    return;
  }

  switch (address) {
    case 0x5100:
      this.prg_size = value & 3;
      break;
    case 0x5101:
      this.chr_size = value & 3;
      break;
    case 0x5102:
      this.sram_we_a = value & 3;
      break;
    case 0x5103:
      this.sram_we_b = value & 3;
      break;
    case 0x5104:
      this.graphic_mode = value & 3;
      break;
    case 0x5105:
      this.nametable_mode = value;
      this.nametable_type[0] = value & 3;
      this.load1kVromBank(value & 3, 0x2000);
      value >>= 2;
      this.nametable_type[1] = value & 3;
      this.load1kVromBank(value & 3, 0x2400);
      value >>= 2;
      this.nametable_type[2] = value & 3;
      this.load1kVromBank(value & 3, 0x2800);
      value >>= 2;
      this.nametable_type[3] = value & 3;
      this.load1kVromBank(value & 3, 0x2c00);
      break;
    case 0x5106:
      this.fill_chr = value;
      break;
    case 0x5107:
      this.fill_pal = value & 3;
      break;
    case 0x5113:
      this.SetBank_SRAM(3, value & 3);
      break;
    case 0x5114:
    case 0x5115:
    case 0x5116:
    case 0x5117:
      this.SetBank_CPU(address, value);
      break;
    case 0x5120:
    case 0x5121:
    case 0x5122:
    case 0x5123:
    case 0x5124:
    case 0x5125:
    case 0x5126:
    case 0x5127:
      this.chr_mode = 0;
      this.chr_page[0][address & 7] = value;
      this.SetBank_PPU();
      break;
    case 0x5128:
    case 0x5129:
    case 0x512a:
    case 0x512b:
      this.chr_mode = 1;
      this.chr_page[1][(address & 3) + 0] = value;
      this.chr_page[1][(address & 3) + 4] = value;
      this.SetBank_PPU();
      break;
    case 0x5200:
      this.split_control = value;
      break;
    case 0x5201:
      this.split_scroll = value;
      break;
    case 0x5202:
      this.split_page = value & 0x3f;
      break;
    case 0x5203:
      this.irq_line = value;
      this.nes.cpu.ClearIRQ();
      break;
    case 0x5204:
      this.irq_enable = value;
      this.nes.cpu.ClearIRQ();
      break;
    case 0x5205:
      this.mult_a = value;
      break;
    case 0x5206:
      this.mult_b = value;
      break;
    default:
      if (address >= 0x5000 && address <= 0x5015) {
        this.nes.papu.exWrite(address, value);
      } else if (address >= 0x5c00 && address <= 0x5fff) {
        if (this.graphic_mode === 2) {
          // ExRAM
          // vram write
        } else if (this.graphic_mode !== 3) {
          // Split,ExGraphic
          if (this.irq_status & 0x40) {
            // vram write
          } else {
            // vram write
          }
        }
      } else if (address >= 0x6000 && address <= 0x7fff) {
        if (this.sram_we_a === 2 && this.sram_we_b === 1) {
          // additional ram write
        }
      }
      break;
  }
};

Mappers[5].prototype.loadROM = function () {
  if (!this.nes.rom.valid) {
    throw new Error("UNROM: Invalid ROM! Unable to load.");
  }

  // Load PRG-ROM:
  this.load8kRomBank(this.nes.rom.romCount * 2 - 1, 0x8000);
  this.load8kRomBank(this.nes.rom.romCount * 2 - 1, 0xa000);
  this.load8kRomBank(this.nes.rom.romCount * 2 - 1, 0xc000);
  this.load8kRomBank(this.nes.rom.romCount * 2 - 1, 0xe000);

  // Load CHR-ROM:
  this.loadCHRROM();

  // Do Reset-Interrupt:
  this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
};

/**
 * Mapper007 (AxROM)
 * @example Battletoads, Time Lord, Marble Madness
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_007
 * @constructor
 */
Mappers[7] = function (nes) {
  this.nes = nes;
};

Mappers[7].prototype = new Mappers[0]();

Mappers[7].prototype.write = function (address, value) {
  // Writes to addresses other than MMC registers are handled by NoMapper.
  if (address < 0x8000) {
    Mappers[0].prototype.write.apply(this, arguments);
  } else {
    this.load32kRomBank(value & 0x7, 0x8000);
    if (value & 0x10) {
      this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING2);
    } else {
      this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING);
    }
  }
};

Mappers[7].prototype.loadROM = function () {
  if (!this.nes.rom.valid) {
    throw new Error("AOROM: Invalid ROM! Unable to load.");
  }

  // Load PRG-ROM:
  this.loadPRGROM();

  // Load CHR-ROM:
  this.loadCHRROM();

  // Do Reset-Interrupt:
  this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
};

/**
 * Mapper 011 (Color Dreams)
 *
 * @description http://wiki.nesdev.com/w/index.php/Color_Dreams
 * @example Crystal Mines, Metal Fighter
 * @constructor
 */
Mappers[11] = function (nes) {
  this.nes = nes;
};

Mappers[11].prototype = new Mappers[0]();

Mappers[11].prototype.write = function (address, value) {
  if (address < 0x8000) {
    Mappers[0].prototype.write.apply(this, arguments);
    return;
  } else {
    // Swap in the given PRG-ROM bank:
    var prgbank1 = ((value & 0xf) * 2) % this.nes.rom.romCount;
    var prgbank2 = ((value & 0xf) * 2 + 1) % this.nes.rom.romCount;

    this.loadRomBank(prgbank1, 0x8000);
    this.loadRomBank(prgbank2, 0xc000);

    if (this.nes.rom.vromCount > 0) {
      // Swap in the given VROM bank at 0x0000:
      var bank = ((value >> 4) * 2) % this.nes.rom.vromCount;
      this.loadVromBank(bank, 0x0000);
      this.loadVromBank(bank + 1, 0x1000);
    }
  }
};

/**
 * Mapper 034 (BNROM, NINA-01)
 *
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_034
 * @example Darkseed, Mashou, Mission Impossible 2
 * @constructor
 */
Mappers[34] = function (nes) {
  this.nes = nes;
};

Mappers[34].prototype = new Mappers[0]();

Mappers[34].prototype.write = function (address, value) {
  if (address < 0x8000) {
    Mappers[0].prototype.write.apply(this, arguments);
    return;
  } else {
    this.load32kRomBank(value, 0x8000);
  }
};

/**
 * Mapper 038
 *
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_038
 * @example Crime Busters
 * @constructor
 */
Mappers[38] = function (nes) {
  this.nes = nes;
};

Mappers[38].prototype = new Mappers[0]();

Mappers[38].prototype.write = function (address, value) {
  if (address < 0x7000 || address > 0x7fff) {
    Mappers[0].prototype.write.apply(this, arguments);
    return;
  } else {
    // Swap in the given PRG-ROM bank at 0x8000:
    this.load32kRomBank(value & 3, 0x8000);

    // Swap in the given VROM bank at 0x0000:
    this.load8kVromBank(((value >> 2) & 3) * 2, 0x0000);
  }
};

/**
 * Mapper 066 (GxROM)
 *
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_066
 * @example Doraemon, Dragon Power, Gumshoe, Thunder & Lightning,
 * Super Mario Bros. + Duck Hunt
 * @constructor
 */
Mappers[66] = function (nes) {
  this.nes = nes;
};

Mappers[66].prototype = new Mappers[0]();

Mappers[66].prototype.write = function (address, value) {
  if (address < 0x8000) {
    Mappers[0].prototype.write.apply(this, arguments);
    return;
  } else {
    // Swap in the given PRG-ROM bank at 0x8000:
    this.load32kRomBank((value >> 4) & 3, 0x8000);

    // Swap in the given VROM bank at 0x0000:
    this.load8kVromBank((value & 3) * 2, 0x0000);
  }
};

/**
 * Mapper 094 (UN1ROM)
 *
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_094
 * @example Senjou no Ookami
 * @constructor
 */
Mappers[94] = function (nes) {
  this.nes = nes;
};

Mappers[94].prototype = new Mappers[0]();

Mappers[94].prototype.write = function (address, value) {
  // Writes to addresses other than MMC registers are handled by NoMapper.
  if (address < 0x8000) {
    Mappers[0].prototype.write.apply(this, arguments);
    return;
  } else {
    // This is a ROM bank select command.
    // Swap in the given ROM bank at 0x8000:
    this.loadRomBank(value >> 2, 0x8000);
  }
};

Mappers[94].prototype.loadROM = function () {
  if (!this.nes.rom.valid) {
    throw new Error("UN1ROM: Invalid ROM! Unable to load.");
  }

  // Load PRG-ROM:
  this.loadRomBank(0, 0x8000);
  this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);

  // Load CHR-ROM:
  this.loadCHRROM();

  // Do Reset-Interrupt:
  this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
};

/**
 * Mapper 140
 *
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_140
 * @example Bio Senshi Dan - Increaser Tono Tatakai
 * @constructor
 */
Mappers[140] = function (nes) {
  this.nes = nes;
};

Mappers[140].prototype = new Mappers[0]();

Mappers[140].prototype.write = function (address, value) {
  if (address < 0x6000 || address > 0x7fff) {
    Mappers[0].prototype.write.apply(this, arguments);
    return;
  } else {
    // Swap in the given PRG-ROM bank at 0x8000:
    this.load32kRomBank((value >> 4) & 3, 0x8000);

    // Swap in the given VROM bank at 0x0000:
    this.load8kVromBank((value & 0xf) * 2, 0x0000);
  }
};

/**
 * Mapper 180
 *
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_180
 * @example Crazy Climber
 * @constructor
 */
Mappers[180] = function (nes) {
  this.nes = nes;
};

Mappers[180].prototype = new Mappers[0]();

Mappers[180].prototype.write = function (address, value) {
  // Writes to addresses other than MMC registers are handled by NoMapper.
  if (address < 0x8000) {
    Mappers[0].prototype.write.apply(this, arguments);
    return;
  } else {
    // This is a ROM bank select command.
    // Swap in the given ROM bank at 0xc000:
    this.loadRomBank(value, 0xc000);
  }
};

Mappers[180].prototype.loadROM = function () {
  if (!this.nes.rom.valid) {
    throw new Error("Mapper 180: Invalid ROM! Unable to load.");
  }

  // Load PRG-ROM:
  this.loadRomBank(0, 0x8000);
  this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);

  // Load CHR-ROM:
  this.loadCHRROM();

  // Do Reset-Interrupt:
  this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
};

/**
 * Mapper 240
 *
 * @description https://www.nesdev.org/wiki/INES_Mapper_240
 * @example Jing Ke Xin Zhuan,Sheng Huo Lie Zhuan
 * @constructor https://blog.heheda.top
 */
Mappers[240] = function (nes) {
  this.nes = nes;
};

Mappers[240].prototype = new Mappers[0]();

Mappers[240].prototype.write = function (address, value) {
  if (address < 0x4020 || address > 0x5fff) {
    Mappers[0].prototype.write.apply(this, arguments);
    return;
  } else {
    // Swap in the given PRG-ROM bank at 0x8000:
    this.load32kRomBank((value >> 4) & 3, 0x8000);

    // Swap in the given VROM bank at 0x0000:
    this.load8kVromBank((value & 0xf) * 2, 0x0000);
  }
};

/**
 * Mapper 241 (BNROM, NINA-01)
 *
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_241
 * @example
 * @constructor https://blog.heheda.top
 */
Mappers[241] = function (nes) {
  this.nes = nes;
};

Mappers[241].prototype = new Mappers[0]();

Mappers[241].prototype.write = function (address, value) {
  if (address < 0x8000) {
    Mappers[0].prototype.write.apply(this, arguments);
    return;
  } else {
    this.load32kRomBank(value, 0x8000);
  }
};

module.exports = Mappers;
