require('dotenv').config();
var express = require('express');
var router = express.Router();
const   fs      = require('fs'),
        multer  = require('multer'),
        AWS     = require('aws-sdk');

const SEARCHBUCKET = process.env.S3_SEARCHBUCKET,
        PUTBUCKET  = process.env.S3_PUTBUCKET;
 
var localFilePath;

AWS.config.loadFromPath('./rootkey.json');
AWS.config.update({
  region: process.env.AWS_REGION
})
  
// S3オブジェクト
const s3 = new AWS.S3();
  
// DynamoDBオブジェクト
const dynamo = new AWS.DynamoDB.DocumentClient();
const SEARCHTABLE = process.env.DYNAMODB_DB_SEARCHTABLE;
const scanParams = {
    TableName: SEARCHTABLE
}
  
// Rekognitionオブジェクト作成
const rekognition = new AWS.Rekognition();

// ファイル保存方法
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // 保存パス
        cb(null, './tmp')
    },
    filename: (req, file, cb) => {
        // 元のファイル名で保存
        cb(null, file.originalname)
        localFilePath = './tmp/' + file.originalname;
    }
});
  
const upload = multer({ storage: storage });

router.get('/', function(req, res, next) {
  res.redirect('/camera');
  // res.render('index');
});

router.post('/', upload.single('file'), async(req, res) => {
  const postFileInfo = JSON.stringify(req.file);

  // 照合結果を返却
  res.send(await receiveFiles(req));
});

const receiveFiles = async(req) => {
 
  const dbAllImages = await scanDB();

  await s3Put(req);

  const searchResults = await imageRekognition(req.file.originalname, dbAllImages);

  return searchResults;
}

const scanDB = () => {
  return new Promise((resolve, reject) => {
      dynamo.scan(scanParams, (err, res) => {
        resolve(res.Items);
      });
  });
}

const s3Put = (req) => {
  return new Promise((resolve, reject) => {
      // S3へのパラメータ
      const s3PutParams = {
          Body: fs.readFileSync(localFilePath), 
          Bucket: PUTBUCKET, 
          Key: req.file.originalname,
          ContentType: req.file.mimetype
      };

      s3.putObject(s3PutParams, (err, data) => {
          if (err) {
              console.log(err, err.stack);
          } else {
              console.log('success s3 uploded ' + req.file.originalname);
              // ローカルのファイル削除
              fs.unlink(localFilePath, (err) => {
                  if (err) {
                      console.log(err, err.stack);
                  } else {
                      console.log('delete localfile ' + localFilePath);
                  }
              });
          }
      });
      resolve();
  });
}

const imageRekognition = async(uploadImage, dbAllImages) => {
  let results = [];
  for (var i = 0; i < dbAllImages.length; i++) {
          // Rekognition実行(promise)
      const result = await execRekognition(uploadImage, dbAllImages[i].path);
      // マッチしない場合はネスト
      if (!Object.keys(result).length) {
          continue;
      }
      results.push(result);
  };
  return results;
};

const execRekognition = (uploadImage, targetPath) => {
  let compareResult = {};
  return new Promise((resolve, reject) => {
      const sendRekognitionParam = setRekognitionParam(uploadImage, targetPath);

      // 画像比較開始
      rekognition.compareFaces(sendRekognitionParam, (err, data) => {
          if (err) {
              console.log('Face recognition was not done ' + targetPath);
              console.log(err);
          } else {
              // 画像として認識されたがunmatch かどうかの判別用
              if (typeof(data.FaceMatches[0]) != 'undefined') {
                  // successful response
                  console.log('match:' + targetPath);
                  compareResult = {
                      path: targetPath,
                      Similarity: data.FaceMatches[0].Similarity
                  };
              } else {
                  console.log('unmatch:' + targetPath);
              }
          }
          resolve(compareResult);
      });
  });
}

const setRekognitionParam = (uploadImage, searchImage) => {
  console.log("uploadImage: " + uploadImage);
  console.log("searchImage: " + searchImage);
  // Rekognition用パラメータ
  return RekognitionParams = {
      SimilarityThreshold: 90, 
      SourceImage: {
          S3Object: {
                  Bucket: PUTBUCKET, 
                  Name: uploadImage
          }
      }, 
      TargetImage: {
          S3Object: {
              Bucket: SEARCHBUCKET, 
              Name: searchImage
          }
      }
  };
}

module.exports = router;
