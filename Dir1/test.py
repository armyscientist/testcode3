# myapp.py
import logging
import mylib
logger = logging.getLogger(__name__)

def main_function():
    logging.basicConfig(filename='myapp.log', level=logging.INFO)
    logger.info('Started')
    mylib.do_something()
    logger.info('Finished')

if __name__ == '__main__':
    main_function()
