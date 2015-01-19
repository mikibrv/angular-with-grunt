/**
 * Created by mcsere on 1/9/15.
 */

module.exports = function (grunt) {
    grunt.config('copy', {
            static: {
                files: [
                    {expand: true, cwd: 'src/', src: ['index.html'], dest: '<%=env.root%>/'},
                    /*  boostrap fonts and images*/
                    {expand: true, cwd: 'src/static/vendor/bootstrap/fonts', src: ['**'], dest: '<%=env.root%>/static/fonts'},
                /** img stuff */
                    {expand: true, cwd: 'src/static/img', src: ['**'], dest: '<%=env.root%>/static/img'},
                    {expand: true, cwd: 'src/app/', src: ['**/*.html'], dest: '<%=env.root%>/app/'}
                ]
            },
            css: {
                files: [
                    {expand: true, cwd: '.tmp/static/css', src: ['**'], dest: '<%=env.root%>/static/css'}
                ]
            },
            app: {

                files: [
                    {expand: true, cwd: 'src/app', src: ['**'], dest: '<%=env.root%>/app'}
                ]
            },
            vendor: {
                files: [
                    {expand: true, cwd: 'src/static/vendor/', src: ['**'], dest: '<%=env.root%>/static/vendor/'}
                ]
            }
        }

    );
};