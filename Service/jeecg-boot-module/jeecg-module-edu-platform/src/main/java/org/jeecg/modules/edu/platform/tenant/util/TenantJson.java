package org.jeecg.modules.edu.platform.tenant.util;

import com.alibaba.fastjson2.JSON;
import org.jeecg.modules.edu.platform.tenant.vo.CertFileVo;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Map;

/**
 * 租户域 JSON 与时间格式化的公共小工具。
 *
 * <p>数据库里 stages / cert_files / switches / quotas 均以 text 存 JSON 字符串
 * （Wave 1 约定：不用 json 类型，兼容 MySQL 5.7 脚本基线），这里统一负责解析与序列化，
 * 避免在每个 Service 里散落重复的 try/catch。
 *
 * @author 教学云
 */
public final class TenantJson {

    /** 与前端 Mock 的 dateAfter() 同口径：yyyy-MM-dd HH:mm:ss */
    private static final DateTimeFormatter DATETIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private TenantJson() {
    }

    /** Date → 字符串；null 原样返回 null */
    public static String fmt(Date date) {
        if (date == null) {
            return null;
        }
        return LocalDateTime.ofInstant(date.toInstant(), ZoneId.systemDefault()).format(DATETIME);
    }

    /**
     * 任意 JDBC 时间值 → Date。
     *
     * <p>MySQL 8 的 {@code getObject()} 对 DATETIME 返回的是 {@link LocalDateTime}（实测
     * mysql-connector-java 8.0.27），而不是 {@code java.sql.Timestamp}。map resultType 查询里
     * 直接用 {@code instanceof Date} 判断会落空，导致时间字段整页变 null。这里统一兜底。
     * 支持 Date / LocalDateTime / 标准字符串，null 或无法解析一律返回 null。
     */
    public static Date toDate(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Date) {
            return (Date) value;
        }
        if (value instanceof LocalDateTime) {
            return Date.from(((LocalDateTime) value).atZone(ZoneId.systemDefault()).toInstant());
        }
        if (value instanceof String) {
            try {
                return Date.from(LocalDateTime.parse((String) value, DATETIME)
                        .atZone(ZoneId.systemDefault()).toInstant());
            } catch (Exception e) {
                return null;
            }
        }
        return null;
    }

    /** 解析字符串数组（如 ["小学","初中"]）；空/非法返回空列表，不让一条脏数据拖垮整页 */
    public static List<String> strArray(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyList();
        }
        try {
            List<String> list = JSON.parseArray(json, String.class);
            return list == null ? Collections.emptyList() : list;
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }

    /** 解析资质材料数组 */
    public static List<CertFileVo> certFiles(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyList();
        }
        try {
            List<CertFileVo> list = JSON.parseArray(json, CertFileVo.class);
            return list == null ? Collections.emptyList() : list;
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }

    /** 解析 JSON 对象（如 switches/quotas/features）；空/非法返回空 Map */
    public static Map<String, Object> obj(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyMap();
        }
        try {
            Map<String, Object> map = JSON.parseObject(json);
            return map == null ? Collections.emptyMap() : map;
        } catch (Exception e) {
            return Collections.emptyMap();
        }
    }

    /** 序列化为 JSON 字符串；null 原样返回 null */
    public static String toJson(Object value) {
        return value == null ? null : JSON.toJSONString(value);
    }
}
