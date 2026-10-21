package org.jeecg.common.util.oss;

import com.aliyun.oss.ClientConfiguration;
import com.aliyun.oss.OSSClient;
import com.aliyun.oss.common.auth.DefaultCredentialProvider;
import com.aliyun.oss.model.CannedAccessControlList;
import com.aliyun.oss.model.OSSObject;
import com.aliyun.oss.model.PutObjectResult;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.fileupload.FileItemStream;
import org.jeecg.common.constant.CommonConstant;
import org.jeecg.common.constant.SymbolConstant;
import org.jeecg.common.util.CommonUtils;
import org.jeecg.common.util.filter.SsrfFileTypeFilter;
import org.jeecg.common.util.filter.StrAttackFilter;
import org.jeecg.common.util.oConvertUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.net.URLDecoder;
import java.util.Date;
import java.util.UUID;

/**
 * @Description: 阿里云 oss 上传工具类(高依赖版)
 * @Date: 2019/5/10
 * @author: jeecg-boot
 */
@Slf4j
public class OssBootUtil {

    private static String endPoint;
    private static String accessKeyId;
    private static String accessKeySecret;
    private static String bucketName;
    private static String staticDomain;

    public static void setEndPoint(String endPoint) {
        OssBootUtil.endPoint = endPoint;
    }

    public static void setAccessKeyId(String accessKeyId) {
        OssBootUtil.accessKeyId = accessKeyId;
    }

    public static void setAccessKeySecret(String accessKeySecret) {
        OssBootUtil.accessKeySecret = accessKeySecret;
    }

    public static void setBucketName(String bucketName) {
        OssBootUtil.bucketName = bucketName;
    }

    public static void setStaticDomain(String staticDomain) {
        OssBootUtil.staticDomain = staticDomain;
    }

    public static String getStaticDomain() {
        return staticDomain;
    }

    public static String getEndPoint() {
        return endPoint;
    }

    public static String getAccessKeyId() {
        return accessKeyId;
    }

    public static String getAccessKeySecret() {
        return accessKeySecret;
    }

    public static String getBucketName() {
        return bucketName;
    }

    public static OSSClient getOssClient() {
        return ossClient;
    }

    /**
     * oss 工具客户端
     */
    private static OSSClient ossClient = null;

    /**
     * 教学云统一对象存储服务。
     *
     * <p>由 {@link OssStorageService#init()} 在启动时注入。存在时所有上传/删除/读取都委托给它，
     * 这样 {@code /sys/common/upload} 这类框架原生接口与教学云业务接口走同一个桶、同一套
     * 私有桶签名逻辑；不存在（未配置 {@code edu.oss}）时退回本类原有的「公读直链」实现。
     */
    private static volatile OssStorageService storage;

    /** Spring 启动时由 {@link OssStorageService} 回调注入 */
    public static void setStorage(OssStorageService service) {
        OssBootUtil.storage = service;
    }

    /** 当前是否已接管到教学云统一存储（私有桶模式） */
    public static boolean isManaged() {
        OssStorageService s = storage;
        return s != null && s.available();
    }

    /**
     * 把框架的 {@code bizPath}（如 {@code upload/test}）折算成对象 Key 的业务分类目录。
     * 只取第一段并做字符清洗，避免框架传来的路径里带 {@code ..} 影响 Key 结构。
     */
    private static String bizOf(String fileDir) {
        if (oConvertUtils.isEmpty(fileDir)) {
            return "common";
        }
        String dir = fileDir.replace('\\', '/');
        while (dir.startsWith("/")) {
            dir = dir.substring(1);
        }
        int slash = dir.indexOf('/');
        if (slash > 0) {
            dir = dir.substring(0, slash);
        }
        String biz = dir.toLowerCase().replaceAll("[^a-z0-9-]", "");
        return biz.isEmpty() ? "common" : biz;
    }

    /**
     * 上传文件至阿里云 OSS
     * 文件上传成功,返回文件完整访问路径
     * 文件上传失败,返回 null
     *
     * @param file    待上传文件
     * @param fileDir 文件保存目录
     * @return oss 中的相对文件路径
     */
    public static String upload(MultipartFile file, String fileDir,String customBucket) throws Exception {
        // 文件安全校验，防止上传漏洞文件
        SsrfFileTypeFilter.checkUploadFileType(file);

        // 教学云：统一走 OssStorageService。私有桶时返回的是「后端签名代理地址」，
        // 而不是 OSS 直链 —— 直链在私有桶下必然 403
        OssStorageService managed = storage;
        if (managed != null && managed.available()) {
            OssStoredObject stored = managed.put(file, bizOf(fileDir), customBucket);
            return stored.getUrl();
        }

        String filePath = null;
        initOss(endPoint, accessKeyId, accessKeySecret);
        StringBuilder fileUrl = new StringBuilder();
        String newBucket = bucketName;
        if(oConvertUtils.isNotEmpty(customBucket)){
            newBucket = customBucket;
        }
        try {
            //判断桶是否存在,不存在则创建桶
            if(!ossClient.doesBucketExist(newBucket)){
                ossClient.createBucket(newBucket);
            }
            // 获取文件名
            String orgName = file.getOriginalFilename();
            if("" == orgName){
              orgName=file.getName();
            }
            orgName = CommonUtils.getFileName(orgName);
            String fileName = orgName.indexOf(".")==-1
                              ?orgName + "_" + System.currentTimeMillis()
                              :orgName.substring(0, orgName.lastIndexOf(".")) + "_" + System.currentTimeMillis() + orgName.substring(orgName.lastIndexOf("."));
            if (!fileDir.endsWith(SymbolConstant.SINGLE_SLASH)) {
                fileDir = fileDir.concat(SymbolConstant.SINGLE_SLASH);
            }
            // 代码逻辑说明: 过滤上传文件夹名特殊字符，防止攻击
            fileDir=StrAttackFilter.filter(fileDir);
            fileUrl = fileUrl.append(fileDir + fileName);

            if (oConvertUtils.isNotEmpty(staticDomain) && staticDomain.toLowerCase().startsWith(CommonConstant.STR_HTTP)) {
                filePath = staticDomain + SymbolConstant.SINGLE_SLASH + fileUrl;
            } else {
                filePath = "https://" + newBucket + "." + endPoint + SymbolConstant.SINGLE_SLASH + fileUrl;
            }
            PutObjectResult result = ossClient.putObject(newBucket, fileUrl.toString(), file.getInputStream());
            // 设置权限(公开读)
//            ossClient.setBucketAcl(newBucket, CannedAccessControlList.PublicRead);
            if (result != null) {
                log.info("------OSS文件上传成功------" + fileUrl);
            }
        } catch (IOException e) {
            log.error(e.getMessage(),e);
            return null;
        }catch (Exception e) {
            log.error(e.getMessage(),e);
            return null;
        }
        return filePath;
    }

    /**
     * 获取原始URL
    * @param url: 原始URL
    * @Return: java.lang.String
    */
    public static String getOriginalUrl(String url) {
        // 教学云：私有桶不能把代理地址转成 OSS 直链（转完就 403），原样返回
        OssStorageService managed = storage;
        if (managed != null && managed.available() && managed.getProperties().isPrivateRead()) {
            return url;
        }
        String originalDomain = "https://" + bucketName + "." + endPoint;
        if(oConvertUtils.isNotEmpty(staticDomain) && url.indexOf(staticDomain)!=-1){
            url = url.replace(staticDomain,originalDomain);
        }
        return url;
    }

    /**
     * 文件上传
     * @param file
     * @param fileDir
     * @return
     */
    public static String upload(MultipartFile file, String fileDir) throws Exception {
        return upload(file, fileDir,null);
    }

    /**
     * 上传文件至阿里云 OSS
     * 文件上传成功,返回文件完整访问路径
     * 文件上传失败,返回 null
     *
     * @param file    待上传文件
     * @param fileDir 文件保存目录
     * @return oss 中的相对文件路径
     */
    public static String upload(FileItemStream file, String fileDir) {
        // 教学云：统一走 OssStorageService（Excel 导入等流式上传场景）
        OssStorageService managed = storage;
        if (managed != null && managed.available()) {
            try {
                OssStoredObject stored = managed.put(file.openStream(), -1, null,
                        file.getName(), bizOf(fileDir), null);
                return stored.getUrl();
            } catch (IOException e) {
                log.error("OSS 流式上传失败：" + e.getMessage(), e);
                return null;
            }
        }

        String filePath = null;
        initOss(endPoint, accessKeyId, accessKeySecret);
        StringBuilder fileUrl = new StringBuilder();
        try {
            String suffix = file.getName().substring(file.getName().lastIndexOf('.'));
            String fileName = UUID.randomUUID().toString().replace("-", "") + suffix;
            if (!fileDir.endsWith(SymbolConstant.SINGLE_SLASH)) {
                fileDir = fileDir.concat(SymbolConstant.SINGLE_SLASH);
            }
            fileDir = StrAttackFilter.filter(fileDir);
            fileUrl = fileUrl.append(fileDir + fileName);
            if (oConvertUtils.isNotEmpty(staticDomain) && staticDomain.toLowerCase().startsWith(CommonConstant.STR_HTTP)) {
                filePath = staticDomain + SymbolConstant.SINGLE_SLASH + fileUrl;
            } else {
                filePath = "https://" + bucketName + "." + endPoint + SymbolConstant.SINGLE_SLASH + fileUrl;
            }
            PutObjectResult result = ossClient.putObject(bucketName, fileUrl.toString(), file.openStream());
            // 设置权限(公开读)
            ossClient.setBucketAcl(bucketName, CannedAccessControlList.PublicRead);
            if (result != null) {
                log.info("------OSS文件上传成功------" + fileUrl);
            }
        } catch (IOException e) {
            e.printStackTrace();
            return null;
        }
        return filePath;
    }

    /**
     * 删除文件
     * @param url
     */
    public static void deleteUrl(String url) {
        deleteUrl(url,null);
    }

    /**
     * 删除文件
     * @param url
     */
    public static void deleteUrl(String url,String bucket) {
        // 教学云：私有桶下库里存的是签名代理地址，必须先反解出 Key 再删
        OssStorageService managed = storage;
        if (managed != null && managed.available()) {
            String key = managed.keyFromUrl(url);
            if (oConvertUtils.isNotEmpty(key)) {
                managed.delete(key);
            }
            return;
        }

        String newBucket = bucketName;
        if(oConvertUtils.isNotEmpty(bucket)){
            newBucket = bucket;
        }
        String bucketUrl = "";
        if (oConvertUtils.isNotEmpty(staticDomain) && staticDomain.toLowerCase().startsWith(CommonConstant.STR_HTTP)) {
            bucketUrl = staticDomain + SymbolConstant.SINGLE_SLASH ;
        } else {
            bucketUrl = "https://" + newBucket + "." + endPoint + SymbolConstant.SINGLE_SLASH;
        }
        //TODO 暂时不允许删除云存储的文件
        //initOss(endPoint, accessKeyId, accessKeySecret);
        url = url.replace(bucketUrl,"");
        ossClient.deleteObject(newBucket, url);
    }

    /**
     * 删除文件
     * @param fileName
     */
    public static void delete(String fileName) {
        OssStorageService managed = storage;
        if (managed != null && managed.available()) {
            managed.delete(managed.keyFromUrl(fileName));
            return;
        }
        ossClient.deleteObject(bucketName, fileName);
    }

    /**
     * 获取指定桶（私有桶）中的文件流
     * 通过OSS SDK直接读取文件内容，支持指定自定义桶名（如 "eoafile"），为空则使用默认桶
     *
     * @param objectName 文件对象路径（如 "eoafile/2026/04/test.pdf"，会自动替换前缀）
     * @param bucket     自定义桶名称，为空则使用默认桶
     * @return 文件输入流，失败返回null
     */
    public static InputStream getOssFile(String objectName,String bucket){
        // 教学云：私有桶统一由 OssStorageService 拉流（它知道默认桶与 Key 的反解规则）
        OssStorageService managed = storage;
        if (managed != null && managed.available()) {
            String key = managed.keyFromUrl(objectName);
            if (oConvertUtils.isNotEmpty(key) && !key.startsWith("http")) {
                try {
                    return new BufferedInputStream(managed.open(key, bucket, -1, -1).getObjectContent());
                } catch (Exception e) {
                    log.info("文件获取失败" + e.getMessage());
                    return null;
                }
            }
        }

        InputStream inputStream = null;
        try{
            String newBucket = bucketName;
            if(oConvertUtils.isNotEmpty(bucket)){
                newBucket = bucket;
            }
            initOss(endPoint, accessKeyId, accessKeySecret);
            // 代码逻辑说明: 替换objectName前缀，防止key不一致导致获取不到文件----
            objectName = OssBootUtil.replacePrefix(objectName,bucket);
            OSSObject ossObject = ossClient.getObject(newBucket,objectName);
            inputStream = new BufferedInputStream(ossObject.getObjectContent());
        }catch (Exception e){
            log.info("文件获取失败" + e.getMessage());
        }
        return inputStream;
    }

    ///**
    // * 获取文件流
    // * @param objectName
    // * @return
    // */
    //public static InputStream getOssFile(String objectName){
    //    return getOssFile(objectName,null);
    //}

    /**
     * 获取私有桶文件的预签名访问URL（带过期时间）
     * 通过OSS预签名机制生成临时访问链接，无需公开桶即可让外部下载/预览文件
     *
     * @param bucketName 桶名称（如 "eoafile"）
     * @param objectName 文件对象路径（会自动替换前缀）
     * @param expires    链接过期时间点（Date类型，如1天后过期）
     * @return 预签名URL字符串，文件不存在或失败返回null
     */
    public static String getObjectUrl(String bucketName, String objectName, Date expires) {
        // 教学云：私有桶的临时链接统一由 OssStorageService 生成（同一套 Key 反解与默认桶）
        OssStorageService managed = storage;
        if (managed != null && managed.available()) {
            String key = managed.keyFromUrl(objectName);
            long seconds = expires == null ? 3600
                    : Math.max(60, (expires.getTime() - System.currentTimeMillis()) / 1000);
            return managed.presignedUrl(key, seconds);
        }
        initOss(endPoint, accessKeyId, accessKeySecret);
        try{
            // 代码逻辑说明: 替换objectName前缀，防止key不一致导致获取不到文件----
            objectName = OssBootUtil.replacePrefix(objectName,bucketName);
            if(ossClient.doesObjectExist(bucketName,objectName)){
                URL url = ossClient.generatePresignedUrl(bucketName,objectName,expires);
                //log.info("原始url : {}", url.toString());
                //log.info("decode url : {}", URLDecoder.decode(url.toString(), "UTF-8"));
                //【issues/4023】问题 oss外链经过转编码后，部分无效，大概在三分一；无需转编码直接返回即可 #4023
                return url.toString();
            }
        }catch (Exception e){
            log.info("文件路径获取失败" + e.getMessage()); 
        }
        return null;
    }

    /**
     * 初始化 oss 客户端
     *
     * @return
     */
    private static OSSClient initOss(String endpoint, String accessKeyId, String accessKeySecret) {
        // 未配置凭据时给出可读的业务提示，而不是让 SDK 抛
        // "Access key id should not be null or empty" —— 后者用户根本不知道要去配哪个变量
        if (oConvertUtils.isEmpty(accessKeyId) || oConvertUtils.isEmpty(accessKeySecret)) {
            throw new org.jeecg.common.exception.JeecgBootException(
                    "对象存储未启用：请先配置阿里云 OSS 凭据（环境变量 EDU_OSS_ACCESS_KEY / EDU_OSS_SECRET_KEY，见 Service/oss.env.example）");
        }
        if (ossClient == null) {
            ossClient = new OSSClient(endpoint,
                    new DefaultCredentialProvider(accessKeyId, accessKeySecret),
                    new ClientConfiguration());
        }
        return ossClient;
    }


    /**
     * 通过输入流上传文件到阿里云OSS默认桶
     * 上传后设置桶为公开读权限，返回文件完整访问URL
     *
     * @param stream       文件输入流
     * @param relativePath 文件在桶中的相对路径（如 "upload/2026/04/test.pdf"）
     * @return 文件完整访问URL（优先使用staticDomain，否则拼接 bucketName.endPoint）
     */
    public static String upload(InputStream stream, String relativePath) {
        // 教学云：统一走 OssStorageService（Key 由调用方指定，常见于导入/导出中转文件）
        OssStorageService managed = storage;
        if (managed != null && managed.available()) {
            OssStoredObject stored = managed.putWithKey(stream, -1, null, relativePath, null);
            return stored.getUrl();
        }

        String filePath = null;
        String fileUrl = relativePath;
        initOss(endPoint, accessKeyId, accessKeySecret);
        if (oConvertUtils.isNotEmpty(staticDomain) && staticDomain.toLowerCase().startsWith(CommonConstant.STR_HTTP)) {
            filePath = staticDomain + SymbolConstant.SINGLE_SLASH + relativePath;
        } else {
            filePath = "https://" + bucketName + "." + endPoint + SymbolConstant.SINGLE_SLASH + fileUrl;
        }
        PutObjectResult result = ossClient.putObject(bucketName, fileUrl.toString(),stream);
        // 设置权限(公开读)
        ossClient.setBucketAcl(bucketName, CannedAccessControlList.PublicRead);
        if (result != null) {
            log.info("------OSS文件上传成功------" + fileUrl);
        }
        return filePath;
    }

    /**
     * 替换前缀，防止key不一致导致获取不到文件
     * @param objectName 文件上传路径 key
     * @param customBucket 自定义桶
     * @date 2022-01-20
     * @author lsq
     * @return
     */
    private static String replacePrefix(String objectName,String customBucket){
        log.info("------replacePrefix---替换前---objectName:{}",objectName);
        if(oConvertUtils.isNotEmpty(staticDomain)){
            objectName= objectName.replace(staticDomain+SymbolConstant.SINGLE_SLASH,"");
        }else{
            String newBucket = bucketName;
            if(oConvertUtils.isNotEmpty(customBucket)){
                newBucket = customBucket;
            }
            String path ="https://" + newBucket + "." + endPoint + SymbolConstant.SINGLE_SLASH;
            objectName = objectName.replace(path,"");
        }
        log.info("------replacePrefix---替换后---objectName:{}",objectName);
        return objectName;
    }
}