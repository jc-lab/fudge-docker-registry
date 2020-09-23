import * as express from 'express';

const router = express.Router();

// const imagePathExpr = '*';
// const digestExpr = '(([A-Za-z0-9_+.-]+):([A-Fa-f0-9]+))$';

/* GET home page. */
router.get('/', (req, res) => {
  res
    .status(200)
    .send({});
});

router.post('/export/multiple', require('./export/post-multiple').default);
router.post('/import/upload', require('./import/post-upload').default);

export default router;
