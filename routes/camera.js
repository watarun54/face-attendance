require('dotenv').config();
var express = require('express');
var router = express.Router();

const base64 = require('urlsafe-base64');
const fs  = require('fs'),
      AWS = require('aws-sdk');
const SEARCHBUCKET = process.env.S3_SEARCHBUCKET,
      PUTBUCKET    = process.env.S3_PUTBUCKET;

var originalFileName
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

// Rekognitionオブジェクト
const rekognition = new AWS.Rekognition();

router.get('/', function(req, res, next) {
  res.render('camera');
});

router.post('/', async(req, res) => {
  save_img_file(req.body.img_src);
  res.send(await receiveFiles());
});

const make_tmp_img_path = function() {
  let random = String(Math.floor(Math.random() * 100000000));
  originalFileName = random + ".jpg";
  return "./tmp/" + originalFileName;
}

const save_img_file = function(img_src) {
  let data = img_src.split(',');
  let b64img = data[ 1 ];
  let img = base64.decode( b64img );

  localFilePath = make_tmp_img_path();

  fs.writeFile(localFilePath, img, function (err) {
    if (err) {console.log("fs.writeFile() error: " + err);}
  });
  return;
}

const receiveFiles = async() => {
  const dbAllImages = await scanDB();
  console.log("scanDB() is done");
  await s3Put();
  console.log("s3Put() is done");
  const searchResults = await imageRekognition(originalFileName, dbAllImages);
  console.log("imageRekognition() is done");
  return searchResults;
}

const scanDB = () => {
  return new Promise((resolve, reject) => {
    dynamo.scan(scanParams, (err, res) => {
      resolve(res.Items);
    });
  });
}

const s3Put = async() => {
  const s3PutParams = {
    Body: fs.readFileSync(localFilePath), 
    Bucket: PUTBUCKET, 
    Key: originalFileName,
    ContentType: 'image/jpeg'
  };

  return new Promise((resolve, reject) => {
    s3.putObject(s3PutParams, (err, data) => {
      if (err) {
        console.log(err, err.stack);
      } else {
        console.log('success s3 uploded ' + originalFileName);
        // ローカルのファイル削除
        fs.unlink(localFilePath, (err) => {
          if (err) {
            console.log(err, err.stack);
          } else {
            console.log('delete localfile ' + localFilePath);
          }
        });
      }
      resolve();
    });
  });
}

const imageRekognition = async(uploadImage, dbAllImages) => {
  let results = [];
  for (var i = 0; i < dbAllImages.length; i++) {
    const result = await execRekognition(uploadImage, dbAllImages[i].path);
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

    rekognition.compareFaces(sendRekognitionParam, (err, data) => {
      if (err) {
        console.log('Face recognition was not done ' + targetPath);
        console.log(err);
      } else {
        if (typeof(data.FaceMatches[0]) != 'undefined') {
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
