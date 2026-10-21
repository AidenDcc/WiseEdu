#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
jeecg 密码哈希（PBEWithMD5AndDES）的纯 Python 实现。

## 为什么需要它

后端 `org.jeecg.common.util.PasswordUtil.encrypt(username, password, salt)`：

    key   = PBE 口令材料 = 登录账号
    plain = 明文密码（UTF-8）
    salt  = sys_user.salt（8 字符，每账号独立）
    算法  = PBEWithMD5AndDES（PBKDF1-MD5，1000 次迭代，DES/CBC/PKCS5Padding）

种子脚本要把 mock 里的演示口令写进 `sys_user.password`，就必须算出同样的哈希。
机器上没有 pycryptodome / cryptography，装库会把「一键重建」变成「先装依赖」，
所以这里手写 DES —— 大约 100 行，且下方自检向量守着正确性：

    DES 标准向量  key=133457799BBCDFF1  pt=0123456789ABCDEF  ct=85E813540F0AB405
    jeecg 向量    encrypt('admin', '123456', 'RCGTeGiH') -> 'cb362cfeefbf3d8d'

自检不过就直接抛异常，绝不让「哈希算错 → 密码永远不对」这种问题静默发生。

## 用法

    python3 db/jeecg_pwd.py <账号> <明文密码> [盐]
    不给盐则随机生成 8 位；输出 "盐<TAB>哈希"，可直接粘进 SQL。
"""
import hashlib
import random
import string
import sys

# ---------------------------------------------------------------- DES 基础表

_IP = [58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
       62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
       57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
       61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7]

_FP = [40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
       38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
       36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
       34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25]

_E = [32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13,
      12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 21, 20, 21, 22, 23,
      24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1]

_P = [16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
      2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25]

_PC1 = [57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18,
        10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
        63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
        14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4]

_PC2 = [14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10,
        23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
        41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48,
        44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32]

_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]

_SBOX = [
    [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
     0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
     4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
     15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
    [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
     3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5,
     0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
     13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
    [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
     13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
     13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
     1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
    [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
     13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
     10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
     3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
    [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
     14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
     4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
     11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
    [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
     10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
     9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
     4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
    [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
     13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
     1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
     6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
    [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
     1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
     7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
     2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
]


def _to_bits(data):
    return [(byte >> (7 - i)) & 1 for byte in data for i in range(8)]


def _from_bits(bits):
    out = bytearray()
    for i in range(0, len(bits), 8):
        value = 0
        for bit in bits[i:i + 8]:
            value = (value << 1) | bit
        out.append(value)
    return bytes(out)


def _permute(bits, table):
    return [bits[pos - 1] for pos in table]


def _subkeys(key8):
    """由 8 字节密钥生成 16 个 48 位子密钥"""
    bits = _permute(_to_bits(key8), _PC1)
    left, right = bits[:28], bits[28:]
    keys = []
    for shift in _SHIFTS:
        left = left[shift:] + left[:shift]
        right = right[shift:] + right[:shift]
        keys.append(_permute(left + right, _PC2))
    return keys


def _feistel(right, subkey):
    expanded = _permute(right, _E)
    mixed = [a ^ b for a, b in zip(expanded, subkey)]
    out = []
    for i in range(8):
        chunk = mixed[i * 6:(i + 1) * 6]
        row = (chunk[0] << 1) | chunk[5]
        col = (chunk[1] << 3) | (chunk[2] << 2) | (chunk[3] << 1) | chunk[4]
        value = _SBOX[i][row * 16 + col]
        out.extend([(value >> 3) & 1, (value >> 2) & 1, (value >> 1) & 1, value & 1])
    return _permute(out, _P)


def des_encrypt_block(block8, key8):
    """单块 DES 加密（ECB 单块，等价于 CBC 只有一块且 IV 无关时的一次运算）"""
    keys = _subkeys(key8)
    bits = _permute(_to_bits(block8), _IP)
    left, right = bits[:32], bits[32:]
    for subkey in keys:
        left, right = right, [a ^ b for a, b in zip(left, _feistel(right, subkey))]
    return _from_bits(_permute(right + left, _FP))


def des_cbc_encrypt(data, key8, iv8):
    """DES/CBC/PKCS5Padding"""
    pad = 8 - len(data) % 8
    data = data + bytes([pad]) * pad
    prev = iv8
    out = bytearray()
    for i in range(0, len(data), 8):
        block = bytes(a ^ b for a, b in zip(data[i:i + 8], prev))
        prev = des_encrypt_block(block, key8)
        out.extend(prev)
    return bytes(out)


# ------------------------------------------------- PBKDF1（PBEWithMD5AndDES 用）

_ITERATIONS = 1000


def _pbkdf1(password_bytes, salt_bytes, count=_ITERATIONS, length=16):
    """PBKDF1/MD5：反复 md5 迭代，取最后一次结果的前 length 字节"""
    digest = hashlib.md5(password_bytes + salt_bytes).digest()
    for _ in range(count - 1):
        digest = hashlib.md5(digest).digest()
    return digest[:length]


def encrypt_password(username, password, salt):
    """
    与 `PasswordUtil.encrypt(username, password, salt)` 完全一致。

    注意参数语义（很容易搞反）：PasswordUtil 的签名是
    `encrypt(plaintext, password, salt)`，jeecg 调用时把 **账号当作明文**、
    **密码当作 PBE 口令**，所以：

        明文   = username
        口令   = password
        盐     = sys_user.salt（直接拼在口令后做 PBKDF1，无额外内部盐）
        输出   = DES/CBC/PKCS5 密文的十六进制小写
    """
    derived = _pbkdf1(password.encode('utf-8'), salt.encode('utf-8'))
    key, iv = derived[:8], derived[8:16]
    return des_cbc_encrypt(username.encode('utf-8'), key, iv).hex()


def random_salt(length=8):
    alphabet = string.ascii_letters + string.digits
    return ''.join(random.choice(alphabet) for _ in range(length))


def verify_password(username, password, salt, hashed):
    return encrypt_password(username, password, salt) == hashed


def _self_test():
    # DES 标准向量
    assert des_encrypt_block(bytes.fromhex('0123456789ABCDEF'),
                             bytes.fromhex('133457799BBCDFF1')).hex() == '85e813540f0ab405', 'DES 向量不符'

    # jeecg 实测向量（由 PasswordUtil 原件算出，见 jshell 复算记录）
    vectors = [
        ('admin', '123456', 'RCGTeGiH', 'cb362cfeefbf3d8d'),
        ('admin', 'admin0123', 'RCGTeGiH', '55bd000f6a455a04'),
    ]
    for username, password, salt, expected in vectors:
        actual = encrypt_password(username, password, salt)
        assert actual == expected, 'PBE 向量不符: %s/%s -> %s != %s' % (
            username, password, actual, expected)


_self_test()


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    _user, _plain = sys.argv[1], sys.argv[2]
    _salt = sys.argv[3] if len(sys.argv) > 3 else random_salt()
    print('%s\t%s' % (_salt, encrypt_password(_user, _plain, _salt)))
